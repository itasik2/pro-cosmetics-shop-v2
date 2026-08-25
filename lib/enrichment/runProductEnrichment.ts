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
  findExternalProductUrl,
  findOfficialProductUrl,
  generateProductDescription,
} from "./openaiResponses";
import {
  ensureDiscoveredSupplierSource,
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
  excludedSourceUrls?: string[];
  autopilotRetryOf?: string | null;
  autopilotRetryCount?: number;
};

function errorMessage(error: unknown) {
  return String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error || "enrichment_failed",
  ).slice(0, 1000);
}

function recoverableAutomaticSourceError(message: string) {
  return (
    [
      "source_timeout",
      "source_dns_not_found",
      "source_redirect_without_location",
      "source_too_many_redirects",
    ].includes(message) ||
    message.startsWith("source_fetch_failed:") ||
    message.startsWith("source_content_type_not_allowed:") ||
    /^source_http_(?:403|404|410|429|5\d\d)$/.test(message)
  );
}

export async function runProductEnrichment(input: RunInput) {
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
  await prisma.enrichmentJob.updateMany({
    where: {
      productId: input.productId,
      status: { in: [EnrichmentJobStatus.PENDING, EnrichmentJobStatus.RUNNING] },
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: EnrichmentJobStatus.FAILED,
      finishedAt: new Date(),
      error: "stale_enrichment_job_recovered",
    },
  });

  const activeJob = await prisma.enrichmentJob.findFirst({
    where: {
      productId: input.productId,
      status: { in: [EnrichmentJobStatus.PENDING, EnrichmentJobStatus.RUNNING] },
    },
    select: { id: true },
  });
  if (activeJob) throw new Error("job_already_running");

  const claimed = await prisma.product.updateMany({
    where: {
      id: input.productId,
      OR: [
        { enrichmentStatus: { not: "RUNNING" } },
        { updatedAt: { lt: staleBefore } },
      ],
    },
    data: { enrichmentStatus: "RUNNING" },
  });
  if (claimed.count !== 1) throw new Error("job_already_running");

  const job = await prisma.enrichmentJob
    .create({
      data: {
        productId: input.productId,
        status: EnrichmentJobStatus.PENDING,
        sourceUrl: input.sourceUrl?.trim() || null,
      },
    })
    .catch(async (error) => {
      await prisma.product
        .updateMany({
          where: { id: input.productId, enrichmentStatus: "RUNNING" },
          data: { enrichmentStatus: "FAILED" },
        })
        .catch(() => undefined);
      throw error;
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
          take: 10,
        },
      },
    });

    if (!product) throw new Error("product_not_found");
    if (!product.supplier) throw new Error("product_supplier_required");
    const searchableProduct = product;
    const supplier = product.supplier;

    await ensureDefaultSupplierSources({
      supplierId: supplier.id,
      supplierSlug: supplier.slug,
      supplierName: supplier.name,
      brandName: product.brand?.name,
    });

    const allowedSources = await getEnabledSupplierSources(supplier.id);
    const officialSources = allowedSources.filter(
      (source) => source.sourceType.toUpperCase() === "OFFICIAL_SITE",
    );
    const officialDomains = officialSources.map((source) => source.domain);
    const excludedSourceUrls = [
      ...new Set(
        (input.excludedSourceUrls || [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ].slice(0, 10);
    const excludedSourceUrlSet = new Set(excludedSourceUrls);
    const explicitSourceUrl = input.sourceUrl?.trim() || "";
    let sourceUrl =
      explicitSourceUrl ||
      (product.sourceUrl && !excludedSourceUrlSet.has(product.sourceUrl.trim())
        ? product.sourceUrl.trim()
        : "") ||
      product.sources.find((source) => !excludedSourceUrlSet.has(source.url))?.url ||
      "";
    let searchResult: Record<string, unknown> | null = null;

    async function discoverSource(excludedUrls: string[] = []) {
      const officialResult = officialDomains.length
        ? await findOfficialProductUrl({
            product: searchableProduct,
            allowedDomains: officialDomains,
            excludedUrls,
          })
        : null;

      if (officialResult?.found && officialResult.url) {
        return {
          url: officialResult.url,
          result: {
            ...officialResult,
            searchStage: "official",
          } as Record<string, unknown>,
        };
      }

      const externalResult = await findExternalProductUrl({
        product: searchableProduct,
        officialDomainsTried: officialDomains,
        excludedUrls,
      });
      const result = {
        ...externalResult,
        searchStage: "external",
        officialResult,
      } as Record<string, unknown>;

      if (!externalResult.found || !externalResult.url) {
        return { url: null, result };
      }

      const discoveredSource = await ensureDiscoveredSupplierSource({
        supplierId: supplier.id,
        url: externalResult.url,
      });
      if (!allowedSources.some((source) => source.id === discoveredSource.id)) {
        allowedSources.push(discoveredSource);
      }

      return { url: externalResult.url, result };
    }

    if (!sourceUrl && input.discoverIfMissing !== false) {
      const discovered = await discoverSource(excludedSourceUrls);
      searchResult = discovered.result;
      if (!discovered.url) throw new Error("product_page_not_found");
      sourceUrl = discovered.url;
    }

    if (!sourceUrl) throw new Error("source_url_required");

    let requestedSource = findSourceForUrl(allowedSources, sourceUrl);
    if (!requestedSource) throw new Error("source_domain_not_allowed");

    let fetched;
    try {
      fetched = await safeFetchHtml(sourceUrl, toAllowedPolicies(allowedSources));
    } catch (error) {
      const message = errorMessage(error);
      const staleAutomaticSource =
        !explicitSourceUrl &&
        input.discoverIfMissing !== false &&
        recoverableAutomaticSourceError(message);

      if (!staleAutomaticSource) throw error;

      const staleUrl = sourceUrl;
      await prisma.product.update({
        where: { id: product.id },
        data: { sourceUrl: null },
      });

      const discovered = await discoverSource([
        ...excludedSourceUrls,
        staleUrl,
      ]);
      searchResult = {
        ...discovered.result,
        retryReason: message,
        staleUrl,
      };

      if (!discovered.url || discovered.url === staleUrl) {
        throw new Error("product_page_not_found_after_stale_source");
      }

      sourceUrl = discovered.url;
      requestedSource = findSourceForUrl(allowedSources, sourceUrl);
      if (!requestedSource) throw new Error("source_domain_not_allowed");
      fetched = await safeFetchHtml(
        sourceUrl,
        toAllowedPolicies(allowedSources),
      );
    }

    let finalSource =
      findSourceForUrl(allowedSources, fetched.finalUrl) || requestedSource;
    let extracted = extractProductFromHtml({
      buffer: fetched.buffer,
      finalUrl: fetched.finalUrl,
      selectors: selectorsFromJson(finalSource.selectors),
    });
    let match = scoreProductMatch(product, extracted);

    if (
      match.confidence === 0 &&
      !explicitSourceUrl &&
      input.discoverIfMissing !== false
    ) {
      const rejectedUrl = fetched.finalUrl;
      const rejectedMatch = match.evidence;
      const discovered = await discoverSource([
        ...excludedSourceUrls,
        rejectedUrl,
      ]);
      searchResult = {
        ...discovered.result,
        retryReason: "product_match_zero_confidence",
        rejectedUrl,
        rejectedMatch,
      };

      if (discovered.url && discovered.url !== rejectedUrl) {
        sourceUrl = discovered.url;
        requestedSource = findSourceForUrl(allowedSources, sourceUrl);
        if (!requestedSource) throw new Error("source_domain_not_allowed");

        try {
          fetched = await safeFetchHtml(
            sourceUrl,
            toAllowedPolicies(allowedSources),
          );
        } catch (error) {
          const message = errorMessage(error);
          if (recoverableAutomaticSourceError(message)) {
            throw new Error("product_match_zero_confidence");
          }
          throw error;
        }

        finalSource =
          findSourceForUrl(allowedSources, fetched.finalUrl) || requestedSource;
        extracted = extractProductFromHtml({
          buffer: fetched.buffer,
          finalUrl: fetched.finalUrl,
          selectors: selectorsFromJson(finalSource.selectors),
        });
        match = scoreProductMatch(product, extracted);
      }
    }

    if (match.confidence === 0) {
      throw new Error("product_match_zero_confidence");
    }

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
      ...(finalSource.sourceType.toUpperCase() !== "OFFICIAL_SITE"
        ? ["external_source_manual_review_required"]
        : []),
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
          autopilotRetry: input.autopilotRetryOf
            ? {
                proposalId: input.autopilotRetryOf,
                count: Math.max(1, Math.trunc(input.autopilotRetryCount || 1)),
                excludedSourceUrls,
              }
            : null,
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
    const sourceRequired = [
      "official_page_not_found",
      "official_page_not_found_after_stale_source",
      "product_page_not_found",
      "product_page_not_found_after_stale_source",
      "product_match_zero_confidence",
    ].includes(message);

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
        data: { enrichmentStatus: sourceRequired ? "SOURCE_REQUIRED" : "FAILED" },
      }),
    ]).catch(() => undefined);

    throw new Error(message);
  }
}
