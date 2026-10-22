import { createHash } from "node:crypto";
import { resolveProductSource, sourceUrlKey } from "./resolveProductSource";
import {
  EnrichmentJobStatus,
  ProductSourceStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeProposalTitle } from "./proposalText";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import {
  latestPriceListImageForProduct,
  priceListImagesBySku,
  priceVariantGroups,
} from "./priceListImages";
import { productForVariant, searchVariantPhotos } from "./variantPhotoSearch";
import { collectProposalPhotos } from "./prepareProposalPhotos";
import { rateProposalPhotoGroups } from "./ratePhotoCandidates";
import { photoSku } from "./variantImages";
import { mergeImageGroups } from "./variantImages";
import { extractProductFromHtml, extractImagesForSku } from "./extractProduct";
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
import { DISCOVERY_BUDGET_MS, remainingTime } from "./timeBudget";
import {
  recoverStaleEnrichmentJobs,
  STALE_ENRICHMENT_MS,
} from "./recoverStaleJobs";

type RunInput = {
  productId: string;
  sourceUrl?: string | null;
  discoverIfMissing?: boolean;
  excludedSourceUrls?: string[];
  autopilotRetryOf?: string | null;
  autopilotRetryCount?: number;
  deadlineAt?: number;
};

function errorMessage(error: unknown) {
  return String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error || "enrichment_failed",
  ).slice(0, 1000);
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function runProductEnrichment(input: RunInput) {
  const deadlineAt = input.deadlineAt ?? Date.now() + DISCOVERY_BUDGET_MS;
  const staleBefore = new Date(Date.now() - STALE_ENRICHMENT_MS);
  await recoverStaleEnrichmentJobs(prisma, [input.productId]);

  const activeJob = await prisma.enrichmentJob.findFirst({
    where: {
      productId: input.productId,
      status: {
        in: [EnrichmentJobStatus.PENDING, EnrichmentJobStatus.RUNNING],
      },
    },
    select: { id: true },
  });
  if (activeJob) throw new Error("job_already_running");

  const claimed = await prisma.product.updateMany({
    where: {
      id: input.productId,
      enrichmentStatus: { not: "MERGED" },
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
    const priceImageUrl =
      (await latestPriceListImageForProduct(product.id))?.url || "";

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
    const excludedSourceUrlSet = new Set(excludedSourceUrls.map(sourceUrlKey));
    const explicitSourceUrl = input.sourceUrl?.trim() || "";
    const initialUrl =
      explicitSourceUrl ||
      (product.sourceUrl &&
      !excludedSourceUrlSet.has(sourceUrlKey(product.sourceUrl))
        ? product.sourceUrl.trim()
        : "") ||
      product.sources.find(
        (source) => !excludedSourceUrlSet.has(sourceUrlKey(source.url)),
      )?.url ||
      "";

    const resolved = await resolveProductSource({
      initialUrl,
      explicit: Boolean(explicitSourceUrl),
      discover: input.discoverIfMissing !== false,
      excludedUrls: excludedSourceUrls,
      deadlineAt,
      stages: [
        {
          stage: "catalog",
          find: async (excludedUrls) => {
            if (
              !searchableProduct.supplierSku ||
              !officialDomains.length ||
              deadlineAt - Date.now() <= 45_000
            )
              return null;
            const direct = await searchVariantPhotos({
              product: searchableProduct,
              variant: {
                sku: searchableProduct.supplierSku,
                label:
                  searchableProduct.volumeValue && searchableProduct.volumeUnit
                    ? `${searchableProduct.volumeValue} ${searchableProduct.volumeUnit}`
                    : "",
              },
              officialDomains,
              policies: toAllowedPolicies(allowedSources),
              priceCandidates: [],
              excludedUrls,
              catalogOnly: true,
              deadlineAt: Math.min(deadlineAt - 40_000, Date.now() + 30_000),
            });
            const url =
              direct.candidates.find((candidate) => candidate.sourceUrl)
                ?.sourceUrl || null;
            return {
              url,
              found: Boolean(url),
              confidence: url ? 100 : 0,
              reason: url
                ? "exact_sku_catalog"
                : direct.status === "INCOMPLETE"
                  ? "catalog_lookup_incomplete"
                  : "catalog_not_found",
            };
          },
        },
        {
          stage: "official",
          find: (excludedUrls) =>
            officialDomains.length
              ? findOfficialProductUrl({
                  product: searchableProduct,
                  allowedDomains: officialDomains,
                  excludedUrls,
                  timeoutMs: remainingTime(deadlineAt, 40_000),
                })
              : Promise.resolve(null),
        },
        {
          stage: "external",
          find: (excludedUrls) =>
            findExternalProductUrl({
              product: searchableProduct,
              officialDomainsTried: officialDomains,
              excludedUrls,
              timeoutMs: remainingTime(deadlineAt, 40_000),
            }),
        },
      ],
      inspect: async (url, stage) => {
        if (stage === "external") {
          const discoveredSource = await ensureDiscoveredSupplierSource({
            supplierId: supplier.id,
            url,
          });
          if (
            !allowedSources.some((source) => source.id === discoveredSource.id)
          )
            allowedSources.push(discoveredSource);
        }
        const requestedSource = findSourceForUrl(allowedSources, url);
        if (!requestedSource) throw new Error("source_domain_not_allowed");
        const fetched = await safeFetchHtml(
          url,
          toAllowedPolicies(allowedSources),
          {
            timeoutMs: remainingTime(deadlineAt, 12_000),
          },
        );
        const finalSource =
          findSourceForUrl(allowedSources, fetched.finalUrl) || requestedSource;
        const extracted = extractProductFromHtml({
          buffer: fetched.buffer,
          finalUrl: fetched.finalUrl,
          selectors: selectorsFromJson(finalSource.selectors),
          expectedSku: product.supplierSku,
        });
        const match = scoreProductMatch(product, extracted);
        if (match.confidence === 0)
          throw new Error("product_match_zero_confidence");
        return { fetched, finalSource, extracted, match };
      },
      onRejected: async ({ url, reason }) => {
        // A dead saved URL must not be picked again on the next attempt.
        await prisma.product.updateMany({
          where: { id: product.id, sourceUrl: url },
          data: { sourceUrl: null },
        });
        await prisma.productSource.updateMany({
          where: { productId: product.id, url },
          data: {
            status: /^source_http_(?:404|410)$/.test(reason)
              ? ProductSourceStatus.UNAVAILABLE
              : ProductSourceStatus.ERROR,
            httpStatus: /^source_http_\d+$/.test(reason)
              ? Number(reason.slice("source_http_".length))
              : null,
            lastCheckedAt: new Date(),
            error: reason.slice(0, 1000),
          },
        });
      },
    });
    const { fetched, finalSource, extracted, match } = resolved.value;
    const searchResult = resolved.searchResult;

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
          timeoutMs: remainingTime(deadlineAt, 20_000),
        });
      } catch (error) {
        generationWarnings.push(
          `description_generation_failed:${errorMessage(error)}`,
        );
      }
    }

    const variants = normalizeStoredVariants(product.variants);
    const priceImages = await priceListImagesBySku([product.id]);
    const variantImageCandidates = mergeImageGroups(
      priceVariantGroups(product.id, variants, priceImages),
      variants
        .filter((variant) => variant.sku)
        .map((variant) => {
          const specific = extractProductFromHtml({
            buffer: fetched.buffer,
            finalUrl: fetched.finalUrl,
            expectedSku: variant.sku,
          });
          const identity = scoreProductMatch(
            productForVariant(product, variant),
            specific,
          );
          const matched =
            photoSku(specific.sku) === photoSku(variant.sku) &&
            identity.evidence.brand !== "mismatch" &&
            identity.evidence.volume !== "mismatch";
          return {
            variantId: variant.id,
            sku: variant.sku!,
            candidates: matched
              ? extractImagesForSku({
                  buffer: fetched.buffer,
                  finalUrl: fetched.finalUrl,
                  sku: variant.sku!,
                  brand: product.brand?.name || product.supplier?.name,
                }).map((url) => ({
                  url,
                  source: "WEB" as const,
                  sourceUrl: fetched.finalUrl,
                }))
              : [],
          };
        }),
    );
    const primarySku = product.supplierSku || variants[0]?.sku;
    const primaryImages =
      primarySku &&
      photoSku(extracted.sku) === photoSku(primarySku) &&
      match.evidence.brand !== "mismatch" &&
      match.evidence.volume !== "mismatch"
        ? extractImagesForSku({
            buffer: fetched.buffer,
            finalUrl: fetched.finalUrl,
            sku: primarySku,
            brand: product.brand?.name || product.supplier?.name,
          }).map((url) => ({
            url,
            source: "WEB" as const,
            sourceUrl: fetched.finalUrl,
          }))
        : [];
    const collected = await collectProposalPhotos({
      product,
      groups: variantImageCandidates,
      productGroups: mergeImageGroups(
        priceVariantGroups(
          product.id,
          primarySku ? [{ id: "product:" + product.id, sku: primarySku }] : [],
          priceImages,
        ),
        primarySku
          ? [
              {
                variantId: "product:" + product.id,
                sku: primarySku,
                candidates: primaryImages,
              },
            ]
          : [],
      ),
      knownUrl: fetched.finalUrl,
      officialDomains,
      policies: toAllowedPolicies(allowedSources),
      deadlineAt: Math.min(deadlineAt - 3_000, Date.now() + 60_000),
    });
    const photos = await rateProposalPhotoGroups(collected, {
      policies: toAllowedPolicies(allowedSources), deadlineAt: deadlineAt - 3_000,
    });
    const proposalImages = [
      ...new Set(
        [
          priceImageUrl,
          ...extracted.images,
          ...[
            ...photos.variantImageCandidates,
            ...photos.productImageCandidates,
          ].flatMap((group) =>
            group.candidates.map((candidate) => candidate.url),
          ),
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ];

    const warnings = [
      ...match.warnings,
      ...generated.warnings,
      ...generationWarnings,
      ...(priceImageUrl ? ["price_list_image_available"] : []),
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
        title: sanitizeProposalTitle(extracted.title, product.name, product),
        shortDescription: generated.shortDescription,
        description: generated.description,
        application: generated.application,
        ingredients: generated.ingredients,
        images: proposalImages as Prisma.InputJsonValue,
        facts: {
          extracted,
          match: match.evidence,
          sourcePrice: extracted.price,
          sourceCurrency: extracted.currency,
          contentChanged: changed,
          searchResult,
          priceImageUrl: priceImageUrl || null,
          ...photos,
          imageCandidates: proposalImages.map((url) => ({
            url,
            source:
              priceImageUrl && url === priceImageUrl ? "PRICE_LIST" : "WEB",
          })),
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

    await prisma
      .$transaction([
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
          data: {
            enrichmentStatus: sourceRequired ? "SOURCE_REQUIRED" : "FAILED",
          },
        }),
      ])
      .catch(() => undefined);

    throw new Error(message);
  }
}
