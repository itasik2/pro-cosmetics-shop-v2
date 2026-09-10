import { normalizeProductImage } from "@/lib/productImageNormalization";
import { prisma } from "@/lib/prisma";

type Variant = {
  id?: unknown;
  image?: unknown;
  [key: string]: unknown;
};

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

export async function getCatalogImageNormalizationCounts() {
  const products = await prisma.product.findMany({
    where: { enrichmentStatus: { not: "MERGED" } },
    select: { image: true, variants: true },
  });

  let normalized = 0;
  let remaining = 0;
  for (const product of products) {
    if (isNormalizedProductImage(product.image)) normalized += 1;
    else if (needsNormalization(product.image)) remaining += 1;

    for (const variant of normalizeVariants(product.variants)) {
      if (isNormalizedProductImage(variant.image)) normalized += 1;
      else if (needsNormalization(variant.image)) remaining += 1;
    }
  }

  return { normalized, remaining };
}

export async function normalizeCatalogImageBatch(maxImages = 3) {
  const limit = Math.max(1, Math.min(5, Math.trunc(maxImages) || 3));
  const products = await prisma.product.findMany({
    where: { enrichmentStatus: { not: "MERGED" } },
    orderBy: { updatedAt: "asc" },
    take: 200,
    select: { id: true, name: true, image: true, variants: true },
  });

  const results: Array<{
    productId: string;
    productName: string;
    target: "primary" | "variant";
    variantId?: string;
    status: "processed" | "failed";
    error?: string;
  }> = [];
  let handled = 0;

  for (const product of products) {
    if (handled >= limit) break;

    if (needsNormalization(product.image)) {
      handled += 1;
      try {
        const sourceUrl = product.image.trim();
        const normalized = await normalizeProductImage(sourceUrl, {
          folder: "pro-cosmetics/products/catalog-originals",
        });

        if (!normalized.processedUrl) {
          results.push({ productId: product.id, productName: product.name, target: "primary", status: "failed", error: normalized.error || "normalization_failed" });
        } else {
          await prisma.$transaction(async (tx) => {
            await tx.productImage.updateMany({ where: { productId: product.id }, data: { isPrimary: false } });
            const existing = await tx.productImage.findFirst({ where: { productId: product.id, url: normalized.url }, select: { id: true } });
            if (existing) {
              await tx.productImage.update({ where: { id: existing.id }, data: { isPrimary: true } });
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
            await tx.product.update({ where: { id: product.id }, data: { image: normalized.url } });
          });
          results.push({ productId: product.id, productName: product.name, target: "primary", status: "processed" });
        }
      } catch (error) {
        results.push({ productId: product.id, productName: product.name, target: "primary", status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "normalization_failed" });
      }
    }

    const variants = normalizeVariants(product.variants);
    for (let index = 0; index < variants.length && handled < limit; index += 1) {
      const variant = variants[index];
      if (!needsNormalization(variant.image)) continue;
      handled += 1;
      const sourceUrl = String(variant.image).trim();
      try {
        const normalized = await normalizeProductImage(sourceUrl, {
          folder: "pro-cosmetics/products/catalog-originals",
        });
        if (!normalized.processedUrl) {
          results.push({ productId: product.id, productName: product.name, target: "variant", variantId: typeof variant.id === "string" ? variant.id : undefined, status: "failed", error: normalized.error || "normalization_failed" });
          continue;
        }
        const nextVariants = variants.map((item, variantIndex) => variantIndex === index ? { ...item, image: normalized.url } : item);
        await prisma.product.update({ where: { id: product.id }, data: { variants: nextVariants as any } });
        variants[index] = { ...variant, image: normalized.url };
        results.push({ productId: product.id, productName: product.name, target: "variant", variantId: typeof variant.id === "string" ? variant.id : undefined, status: "processed" });
      } catch (error) {
        results.push({ productId: product.id, productName: product.name, target: "variant", variantId: typeof variant.id === "string" ? variant.id : undefined, status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "normalization_failed" });
      }
    }
  }

  const counts = await getCatalogImageNormalizationCounts();
  return {
    processed: results.filter((item) => item.status === "processed").length,
    failed: results.filter((item) => item.status === "failed").length,
    remaining: counts.remaining,
    normalized: counts.normalized,
    results,
  };
}
