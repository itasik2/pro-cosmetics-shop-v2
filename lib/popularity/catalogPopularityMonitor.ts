import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { productIdentityKey } from "@/lib/price-import/productVariants";
import { assessCatalogPopularity } from "@/lib/enrichment/openaiResponses";

export type CatalogPopularityConfig = {
  enabled: boolean;
  batchSize: number;
  autoSlots: number;
  minScore: number;
  staleDays: number;
};

function integerFromEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function getCatalogPopularityConfig(): CatalogPopularityConfig {
  return {
    enabled:
      process.env.CATALOG_POPULARITY_MONITOR_ENABLED?.trim().toLowerCase() !==
      "false",
    batchSize: integerFromEnv(
      process.env.CATALOG_POPULARITY_MONITOR_BATCH,
      8,
      1,
      12,
    ),
    autoSlots: integerFromEnv(
      process.env.CATALOG_POPULARITY_AUTO_SLOTS,
      8,
      1,
      12,
    ),
    minScore: integerFromEnv(
      process.env.CATALOG_POPULARITY_MIN_SCORE,
      65,
      65,
      95,
    ),
    staleDays: integerFromEnv(
      process.env.CATALOG_POPULARITY_STALE_DAYS,
      14,
      3,
      60,
    ),
  };
}

function candidateKey(candidate: {
  id: string;
  name: string;
  volumeValue: number | null;
  volumeUnit: string | null;
  brand: { name: string } | null;
}) {
  return (
    productIdentityKey({
      brandName: candidate.brand?.name,
      name: candidate.name,
      volumeValue: candidate.volumeValue,
      volumeUnit: candidate.volumeUnit,
    }) || candidate.id
  );
}

function independentEvidenceCount(urls: string[]) {
  return new Set(
    urls.flatMap((value) => {
      try {
        return [new URL(value).hostname.toLowerCase().replace(/^www\./, "")];
      } catch {
        return [];
      }
    }),
  ).size;
}

async function reconcileAutoPopularProducts(config: CatalogPopularityConfig) {
  const freshAfter = new Date(
    Date.now() - Math.max(30, config.staleDays * 3) * 24 * 60 * 60 * 1000,
  );
  const ranked = await prisma.product.findMany({
    where: {
      isPublished: true,
      stock: { gt: 0 },
      enrichmentStatus: { not: "MERGED" },
      popularityPinned: false,
      popularityExcluded: false,
      popularityScore: { gte: config.minScore },
      popularityConfidence: { gte: 70 },
      popularityCheckedAt: { gte: freshAfter },
    },
    orderBy: [
      { popularityScore: "desc" },
      { popularityConfidence: "desc" },
      { popularityCheckedAt: "desc" },
    ],
    take: config.autoSlots * 5,
    select: {
      id: true,
      name: true,
      volumeValue: true,
      volumeUnit: true,
      brand: { select: { name: true } },
    },
  });

  const seen = new Set<string>();
  const selected = ranked.filter((product) => {
    const key = candidateKey(product);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, config.autoSlots);
  const selectedIds = selected.map((product) => product.id);

  await prisma.$transaction([
    prisma.product.updateMany({
      where: {
        popularityPinned: false,
        isPopular: true,
      },
      data: { isPopular: false },
    }),
    ...(selectedIds.length
      ? [
          prisma.product.updateMany({
            where: {
              id: { in: selectedIds },
              popularityPinned: false,
              popularityExcluded: false,
            },
            data: { isPopular: true },
          }),
        ]
      : []),
  ]);

  return selected;
}

export async function runCatalogPopularityMonitor() {
  const config = getCatalogPopularityConfig();
  const startedAt = new Date();

  if (!config.enabled) {
    return {
      enabled: false,
      config,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      evaluated: [],
      popularProductIds: [],
    };
  }

  const staleBefore = new Date(
    Date.now() - config.staleDays * 24 * 60 * 60 * 1000,
  );
  const rows = await prisma.product.findMany({
    where: {
      isPublished: true,
      stock: { gt: 0 },
      enrichmentStatus: { not: "MERGED" },
      popularityPinned: false,
      popularityExcluded: false,
      OR: [
        { popularityCheckedAt: null },
        { popularityCheckedAt: { lt: staleBefore } },
      ],
    },
    orderBy: [
      { popularityCheckedAt: { sort: "asc", nulls: "first" } },
      { createdAt: "asc" },
    ],
    take: config.batchSize * 4,
    select: {
      id: true,
      name: true,
      shortDescription: true,
      category: true,
      volumeValue: true,
      volumeUnit: true,
      brand: { select: { name: true } },
    },
  });

  const seen = new Set<string>();
  const candidates = rows.filter((product) => {
    const key = candidateKey(product);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, config.batchSize);

  let evaluations: Array<{
    productId: string;
    score: number;
    confidence: number;
    reason: string;
    evidenceUrls: string[];
  }> = [];

  if (candidates.length) {
    const rawAssessments = await assessCatalogPopularity({
      market: "Казахстан",
      candidates: candidates.map((product) => ({
        id: product.id,
        name: product.name,
        brandName: product.brand?.name,
        category: product.category,
        shortDescription: product.shortDescription,
      })),
    });
    const assessmentsById = new Map(
      rawAssessments.map((assessment) => [assessment.productId, assessment]),
    );
    const checkedAt = new Date();

    evaluations = candidates.map((product) => {
      const assessment = assessmentsById.get(product.id);
      const evidenceUrls = assessment?.evidenceUrls || [];
      const confidence = assessment?.confidence || 0;
      const enoughEvidence =
        confidence >= 70 && independentEvidenceCount(evidenceUrls) >= 2;
      const score = enoughEvidence
        ? assessment?.score || 0
        : Math.min(64, assessment?.score || 0);
      const reason = assessment
        ? enoughEvidence
          ? assessment.reason
          : `${assessment.reason} Недостаточно независимых подтверждений для автоматического продвижения.`
        : "Мониторинг не вернул подтверждённую оценку для этого товара.";

      return {
        productId: product.id,
        score,
        confidence,
        reason,
        evidenceUrls,
      };
    });

    await prisma.$transaction(
      evaluations.map((evaluation) =>
        prisma.product.update({
          where: { id: evaluation.productId },
          data: {
            popularityScore: evaluation.score,
            popularityConfidence: evaluation.confidence,
            popularityReason: evaluation.reason,
            popularityEvidence:
              evaluation.evidenceUrls as Prisma.InputJsonValue,
            popularityCheckedAt: checkedAt,
          },
        }),
      ),
    );
  }

  const popular = await reconcileAutoPopularProducts(config);

  return {
    enabled: true,
    config,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    evaluated: evaluations,
    popularProductIds: popular.map((product) => product.id),
  };
}
