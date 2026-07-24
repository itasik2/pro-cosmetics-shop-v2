import { createHash } from "node:crypto";
import {
  EnrichmentJobStatus,
  ProductSourceStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractProductFromHtml } from "./extractProduct";
import { scoreProductMatch } from "./matchProduct";
import { safeFetchHtml } from "./network";
import {
  fallbackDescription,
  findOfficialProductUrl,
  generateProductDescription,
} from "./openaiResponses";
import {
  ensureDefaultSupplierSources,
  findSourceForUrl,
  getEnabledSupplierSources,
  selectorsFromJson,
  toAllowedPolicies,
} from "./sourcePolicies";

type RunInput = {
  productId: string;
  sourceUrl?: string | null;
  discoverIfMissing?: boolean;
};

function errorMessage(error: unknown) {
  return String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error || "enrichment_failed",
  ).slice(0, 1000);
}

export async function runProductEnrichment(input: RunInput) {
  const job = await prisma.enrichmentJob.create({
    data: {
      productId: input.productId,
      status: EnrichmentJobStatus.PENDING,
      sourceUrl: input.sourceUrl?.trim() || null,
    },
  });

  await prisma.product.update({
    where: { id: input.productId },
    data: { enrichmentStatus: "RUNNING" },
  });

  try {
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        status: EnrichmentJobStatus.RUNNING,
        startedAt: new Date(),
        attempt: { increment: 1 },
      },
    });

    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      include: {
        brand: { select: { name: true } },
        supplier: { select: { id: true, name: true, slug: true } },
        sources: {
          where: { status: ProductSourceStatus.ACTIVE },
          orderBy: { lastCheckedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!product) throw new Error("product_not_found");
    if (!product.supplier) throw new Error("product_supplier_required");

    await ensureDefaultSupplierSources({
      supplierId: product.supplier.id,
      supplierSlug: product.supplier.slug,
    });

    const allowedSources = await getEnabledSupplierSources(product.supplier.id);
    if (!allowedSources.length) throw new Error("enabled_sources_required");

    const policies = toAllowedPolicies(allowedSources);
    let sourceUrl =
      input.sourceUrl?.trim() ||
      product.sourceUrl?.trim() ||
      product.sources[0]?.url ||
      "";
    let searchResult: Record<string, unknown> | null = null;

    if (!sourceUrl && input.discoverIfMissing !== false) {
      const found = await findOfficialProductUrl({
        product,
        allowedDomains: allowedSources.map((source) => source.domain),
      });
      searchResult = found;
      if (!found.found || !found.url) throw new Error("official_page_not_found");
      sourceUrl = found.url;
    }

    if (!sourceUrl) throw new Error("source_url_required");

    const requestedSource = findSourceForUrl(allowedSources, sourceUrl);
    if (!requestedSource) throw new Error("source_domain_not_allowed");

    const fetched = await safeFetchHtml(sourceUrl, policies);
    const finalSource =
      findSourceForUrl(allowedSources, fetched.finalUrl) || requestedSource;
    const extracted = extractProductFromHtml({
      buffer: fetched.buffer,
      finalUrl: fetched.finalUrl,
      selectors: selectorsFromJson(finalSource.selectors),
    });
    const match = scoreProductMatch(product, extracted);
    const contentHash = createHash("sha256")
      .update(fetched.buffer)
      .digest("hex");

    const existingSource = await prisma.productSource.findUnique({
      where: {
        productId_url: {
          productId: product.id,
          url: fetched.finalUrl,
        },
      },
      select: { id: true, contentHash: true, lastChangedAt: true },
    });
    const changed = existingSource?.contentHash !== contentHash;

    const productSource = await prisma.productSource.upsert({
      where: {
        productId_url: {
          productId: product.id,
          url: fetched.finalUrl,
        },
      },
      update: {
        supplierSourceId: finalSource.id,
        canonicalUrl: extracted.canonicalUrl,
        title: extracted.title,
        contentHash,
        lastCheckedAt: new Date(),
        lastChangedAt: changed ? new Date() : existingSource?.lastChangedAt,
        status: ProductSourceStatus.ACTIVE,
        httpStatus: fetched.status,
        rawData: {
          contentType: fetched.contentType,
          headers: fetched.headers,
          jsonLd: extracted.rawJsonLd,
          searchResult,
        } as Prisma.InputJsonValue,
        extractedData: extracted as unknown as Prisma.InputJsonValue,
        error: null,
      },
      create: {
        productId: product.id,
        supplierSourceId: finalSource.id,
        url: fetched.finalUrl,
        canonicalUrl: extracted.canonicalUrl,
        sourceType: finalSource.sourceType,
        title: extracted.title,
        contentHash,
        lastCheckedAt: new Date(),
        lastChangedAt: new Date(),
        status: ProductSourceStatus.ACTIVE,
        httpStatus: fetched.status,
        rawData: {
          contentType: fetched.contentType,
          headers: fetched.headers,
          jsonLd: extracted.rawJsonLd,
          searchResult,
        } as Prisma.InputJsonValue,
        extractedData: extracted as unknown as Prisma.InputJsonValue,
      },
    });

    let generated = fallbackDescription(extracted);
    const generationWarnings: string[] = [];

    if (process.env.OPENAI_API_KEY) {
      try {
        generated = await generateProductDescription({
          product,
          extracted,
          sourceUrl: fetched.finalUrl,
        });
      } catch (error) {
        generationWarnings.push(`description_generation_failed:${errorMessage(error)}`);
      }
    }

    const warnings = [
      ...match.warnings,
      ...generated.warnings,
      ...generationWarnings,
      ...(changed && existingSource ? ["source_content_changed"] : []),
      ...(match.confidence < 70 ? ["manual_match_review_required"] : []),
    ];

    const proposal = await prisma.productEnrichmentProposal.create({
      data: {
        productId: product.id,
        sourceId: productSource.id,
        jobId: job.id,
        sourceUrl: fetched.finalUrl,
        confidence: match.confidence,
        title: extracted.title,
        shortDescription: generated.shortDescription,
        description: generated.description,
        application: generated.application,
        ingredients: generated.ingredients,
        images: extracted.images as Prisma.InputJsonValue,
        facts: {
          extracted,
          match: match.evidence,
          sourcePrice: extracted.price,
          sourceCurrency: extracted.currency,
          contentChanged: changed,
          searchResult,
        } as unknown as Prisma.InputJsonValue,
        warnings: [...new Set(warnings)] as Prisma.InputJsonValue,
      },
    });

    await prisma.$transaction([
      prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: EnrichmentJobStatus.REVIEW,
          sourceUrl: fetched.finalUrl,
          result: {
            proposalId: proposal.id,
            confidence: match.confidence,
            changed,
          },
          finishedAt: new Date(),
          error: null,
        },
      }),
      prisma.product.update({
        where: { id: product.id },
        data: {
          enrichmentStatus: "REVIEW",
          sourceUrl: fetched.finalUrl,
        },
      }),
    ]);

    return prisma.productEnrichmentProposal.findUnique({
      where: { id: proposal.id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            supplierSku: true,
            image: true,
            isPublished: true,
          },
        },
        source: true,
        job: true,
      },
    });
  } catch (error) {
    const message = errorMessage(error);

    await prisma.$transaction([
      prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: EnrichmentJobStatus.FAILED,
          finishedAt: new Date(),
          error: message,
        },
      }),
      prisma.product.update({
        where: { id: input.productId },
        data: { enrichmentStatus: "FAILED" },
      }),
    ]).catch(() => undefined);

    throw new Error(message);
  }
}
