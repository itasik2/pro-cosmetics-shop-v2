import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeProductImage } from "@/lib/productImageNormalization";
import { prisma } from "@/lib/prisma";

type Variant = {
  id?: unknown;
  image?: unknown;
  [key: string]: unknown;
};

type AttemptRow = {
  productId: string;
  targetKey: string;
  sourceUrlHash: string;
  attempts: number;
  status: string;
  lastError: string | null;
  lastAttemptAt: Date | null;
};

const MAX_ATTEMPTS = 3;
const RETRY_COOLDOWN_MS = 60 * 60 * 1000;

function isHttpsImage(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value.trim());
}

export function isNormalizedProductImage(value: unknown) {
  return typeof value === "string" && value.includes("e_background_removal");
}

function needsNormalization(value: unknown) {
  return isHttpsImage(value) && !isNormalizedProductImage(value);
}

function normalizeVariants(value: unknown): Variant[] {
  return Array.isArray(value)
    ? value.filter((item): item is Variant => Boolean(item && typeof item === "object"))
    : [];
}

function hostname(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sourceUrlHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function variantTargetKey(variant: Variant, index: number) {
  const id = typeof variant.id === "string" ? variant.id.trim() : "";
  return id ? `variant:${id}` : `variant-index:${index}`;
}

function attemptMapKey(productId: string, targetKey: string, sourceUrl: string) {
  return `${productId}|${targetKey}|${sourceUrlHash(sourceUrl)}`;
}

async function loadAttempts(productIds: string[]) {
  if (!productIds.length) return new Map<string, AttemptRow>();

  const rows = await prisma.$queryRaw<AttemptRow[]>(Prisma.sql`
    SELECT
      "productId",
      "targetKey",
      "sourceUrlHash",
      "attempts",
      "status",
      "lastError",
      "lastAttemptAt"
    FROM "ImageNormalizationAttempt"
    WHERE "productId" IN (${Prisma.join(productIds)})
  `);

  const map = new Map<string, AttemptRow>();
  for (const row of rows) {
    map.set(`${row.productId}|${row.targetKey}|${row.sourceUrlHash}`, row);
  }
  return map;
}

function attemptState(attempt: AttemptRow | undefined) {
  if (!attempt) return "ready" as const;
  if (attempt.status === "NEEDS_REVIEW") return "needs_review" as const;

  if (
    attempt.status === "FAILED" &&
    attempt.lastAttemptAt &&
    Date.now() - new Date(attempt.lastAttemptAt).getTime() < RETRY_COOLDOWN_MS
  ) {
    return "cooldown" as const;
  }

  return "ready" as const;
}

async function recordFailure(input: {
  productId: string;
  targetKey: string;
  sourceUrl: string;
  error: string;
}) {
  const hash = sourceUrlHash(input.sourceUrl);
  const rows = await prisma.$queryRaw<Array<{ attempts: number; status: string }>>(Prisma.sql`
    INSERT INTO "ImageNormalizationAttempt" (
      "id",
      "productId",
      "targetKey",
      "sourceUrlHash",
      "sourceUrl",
      "attempts",
      "status",
      "lastError",
      "lastAttemptAt",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${randomUUID()},
      ${input.productId},
      ${input.targetKey},
      ${hash},
      ${input.sourceUrl},
      1,
      'FAILED',
      ${input.error},
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT ("productId", "targetKey", "sourceUrlHash")
    DO UPDATE SET
      "attempts" = "ImageNormalizationAttempt"."attempts" + 1,
      "status" = CASE
        WHEN "ImageNormalizationAttempt"."attempts" + 1 >= ${MAX_ATTEMPTS}
          THEN 'NEEDS_REVIEW'
        ELSE 'FAILED'
      END,
      "sourceUrl" = EXCLUDED."sourceUrl",
      "lastError" = EXCLUDED."lastError",
      "lastAttemptAt" = NOW(),
      "updatedAt" = NOW()
    RETURNING "attempts", "status"
  `);

  return rows[0] || { attempts: 1, status: "FAILED" };
}

async function clearAttempt(productId: string, targetKey: string, sourceUrl: string) {
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "ImageNormalizationAttempt"
    WHERE "productId" = ${productId}
      AND "targetKey" = ${targetKey}
      AND "sourceUrlHash" = ${sourceUrlHash(sourceUrl)}
  `);
}

export async function resetNeedsReviewAttempts() {
  const reset = await prisma.$executeRaw(Prisma.sql`
    UPDATE "ImageNormalizationAttempt"
    SET
      "attempts" = 0,
      "status" = 'PENDING',
      "lastError" = NULL,
      "lastAttemptAt" = NULL,
      "updatedAt" = NOW()
    WHERE "status" = 'NEEDS_REVIEW'
  `);

  return Number(reset) || 0;
}

export async function getCatalogImageNormalizationCounts() {
  const products = await prisma.product.findMany({
    where: { enrichmentStatus: { not: "MERGED" } },
    select: { id: true, image: true, variants: true },
  });
  const attempts = await loadAttempts(products.map((product) => product.id));

  let normalized = 0;
  let remaining = 0;
  let retryPending = 0;
  let needsReview = 0;

  function countTarget(productId: string, targetKey: string, image: unknown) {
    if (isNormalizedProductImage(image)) {
      normalized += 1;
      return;
    }
    if (!needsNormalization(image)) return;

    const sourceUrl = String(image).trim();
    const state = attemptState(attempts.get(attemptMapKey(productId, targetKey, sourceUrl)));
    if (state === "needs_review") needsReview += 1;
    else if (state === "cooldown") retryPending += 1;
    else remaining += 1;
  }

  for (const product of products) {
    countTarget(product.id, "primary", product.image);

    const variants = normalizeVariants(product.variants);
    for (let index = 0; index < variants.length; index += 1) {
      countTarget(
        product.id,
        variantTargetKey(variants[index], index),
        variants[index].image,
      );
    }
  }

  return { normalized, remaining, retryPending, needsReview };
}

export async function normalizeCatalogImageBatch(maxImages = 3) {
  const limit = Math.max(1, Math.min(5, Math.trunc(maxImages) || 3));
  const products = await prisma.product.findMany({
    where: { enrichmentStatus: { not: "MERGED" } },
    orderBy: { updatedAt: "asc" },
    take: 200,
    select: { id: true, name: true, image: true, variants: true },
  });
  const attempts = await loadAttempts(products.map((product) => product.id));

  const results: Array<{
    productId: string;
    productName: string;
    target: "primary" | "variant";
    variantId?: string;
    status: "processed" | "failed" | "needs_review";
    attempts?: number;
    error?: string;
  }> = [];
  let handled = 0;

  async function failTarget(input: {
    productId: string;
    productName: string;
    target: "primary" | "variant";
    targetKey: string;
    sourceUrl: string;
    variantId?: string;
    error: unknown;
  }) {
    const message =
      input.error instanceof Error
        ? input.error.message.slice(0, 300)
        : String(input.error || "normalization_failed").slice(0, 300);
    const attempt = await recordFailure({
      productId: input.productId,
      targetKey: input.targetKey,
      sourceUrl: input.sourceUrl,
      error: message,
    });
    results.push({
      productId: input.productId,
      productName: input.productName,
      target: input.target,
      variantId: input.variantId,
      status: attempt.status === "NEEDS_REVIEW" ? "needs_review" : "failed",
      attempts: attempt.attempts,
      error: message,
    });
  }

  for (const product of products) {
    if (handled >= limit) break;

    if (needsNormalization(product.image)) {
      const sourceUrl = product.image.trim();
      const targetKey = "primary";
      const state = attemptState(attempts.get(attemptMapKey(product.id, targetKey, sourceUrl)));

      if (state === "ready") {
        handled += 1;
        try {
          const normalized = await normalizeProductImage(sourceUrl, {
            folder: "pro-cosmetics/products/catalog-originals",
          });

          if (!normalized.processedUrl) {
            await failTarget({
              productId: product.id,
              productName: product.name,
              target: "primary",
              targetKey,
              sourceUrl,
              error: normalized.error || "normalization_failed",
            });
          } else {
            await prisma.$transaction(async (tx) => {
              await tx.productImage.updateMany({
                where: { productId: product.id },
                data: { isPrimary: false },
              });
              const existing = await tx.productImage.findFirst({
                where: { productId: product.id, url: normalized.url },
                select: { id: true },
              });
              if (existing) {
                await tx.productImage.update({
                  where: { id: existing.id },
                  data: { isPrimary: true },
                });
              } else {
                await tx.productImage.create({
                  data: {
                    productId: product.id,
                    url: normalized.url,
                    sourceUrl: normalized.originalUrl,
                    sourceDomain: hostname(sourceUrl),
                    width: normalized.width,
                    height: normalized.height,
                    isPrimary: true,
                  },
                });
              }
              await tx.product.update({
                where: { id: product.id },
                data: { image: normalized.url },
              });
            });
            await clearAttempt(product.id, targetKey, sourceUrl);
            results.push({
              productId: product.id,
              productName: product.name,
              target: "primary",
              status: "processed",
            });
          }
        } catch (error) {
          await failTarget({
            productId: product.id,
            productName: product.name,
            target: "primary",
            targetKey,
            sourceUrl,
            error,
          });
        }
      }
    }

    const variants = normalizeVariants(product.variants);
    for (let index = 0; index < variants.length && handled < limit; index += 1) {
      const variant = variants[index];
      if (!needsNormalization(variant.image)) continue;

      const sourceUrl = String(variant.image).trim();
      const targetKey = variantTargetKey(variant, index);
      const state = attemptState(attempts.get(attemptMapKey(product.id, targetKey, sourceUrl)));
      if (state !== "ready") continue;

      handled += 1;
      const variantId = typeof variant.id === "string" ? variant.id : undefined;
      try {
        const normalized = await normalizeProductImage(sourceUrl, {
          folder: "pro-cosmetics/products/catalog-originals",
        });
        if (!normalized.processedUrl) {
          await failTarget({
            productId: product.id,
            productName: product.name,
            target: "variant",
            targetKey,
            sourceUrl,
            variantId,
            error: normalized.error || "normalization_failed",
          });
          continue;
        }

        const nextVariants = variants.map((item, variantIndex) =>
          variantIndex === index ? { ...item, image: normalized.url } : item,
        );
        await prisma.product.update({
          where: { id: product.id },
          data: { variants: nextVariants as any },
        });
        variants[index] = { ...variant, image: normalized.url };
        await clearAttempt(product.id, targetKey, sourceUrl);
        results.push({
          productId: product.id,
          productName: product.name,
          target: "variant",
          variantId,
          status: "processed",
        });
      } catch (error) {
        await failTarget({
          productId: product.id,
          productName: product.name,
          target: "variant",
          targetKey,
          sourceUrl,
          variantId,
          error,
        });
      }
    }
  }

  const counts = await getCatalogImageNormalizationCounts();
  return {
    processed: results.filter((item) => item.status === "processed").length,
    failed: results.filter((item) => item.status === "failed").length,
    movedToReview: results.filter((item) => item.status === "needs_review").length,
    remaining: counts.remaining,
    retryPending: counts.retryPending,
    needsReview: counts.needsReview,
    normalized: counts.normalized,
    results,
  };
}
