import { prisma } from "@/lib/prisma";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import { photoSku, type VariantImageGroup } from "./variantImages";

export type PriceListImageCandidate = {
  productId: string;
  sku: string;
  url: string;
  importId: string;
  fileName: string;
  rowNumber: number;
};
function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function rowImageUrl(row: { parsedData: unknown; rawData: unknown }) {
  const parsed = jsonObject(row.parsedData),
    raw = jsonObject(row.rawData);
  const url = String(parsed.priceImageUrl || raw.priceImageUrl || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}
export async function latestPricePackageLabel(productId: string, sku: string | null) {
  if (!sku) return "";
  const row = await prisma.priceImportRow.findFirst({
    where: { productId, supplierSku: sku, appliedAt: { not: null } },
    orderBy: [{ import: { sourceDate: "desc" } }, { appliedAt: "desc" }],
    select: { rawData: true, parsedData: true },
  });
  if (!row) return "";
  const parsed = jsonObject(row.parsedData), raw = jsonObject(row.rawData);
  if (parsed.supplierSku && photoSku(parsed.supplierSku) !== photoSku(sku)) return "";
  return typeof (parsed.volumeLabel || raw.volumeLabel) === "string"
    ? String(parsed.volumeLabel || raw.volumeLabel).slice(0, 200) : "";
}
export function priceImageKey(
  productId: string,
  sku: string | null | undefined,
) {
  return productId + "\n" + photoSku(sku);
}
export async function priceListImagesBySku(
  productIds: string[],
  preferredImportId?: string | null,
) {
  const ids = [...new Set(productIds.filter(Boolean))];
  const result = new Map<string, PriceListImageCandidate>();
  if (!ids.length) return result;
  const rows = await prisma.priceImportRow.findMany({
    where: {
      productId: { in: ids },
      appliedAt: { not: null },
      ...(preferredImportId ? { importId: preferredImportId } : {}),
    },
    orderBy: [{ import: { sourceDate: "desc" } }, { appliedAt: "desc" }],
    select: {
      productId: true,
      supplierSku: true,
      rowNumber: true,
      parsedData: true,
      rawData: true,
      import: { select: { id: true, fileName: true } },
    },
    take: 5000,
  });
  for (const row of rows) {
    const url = rowImageUrl(row);
    const parsedSku = jsonObject(row.parsedData).supplierSku;
    if (
      !row.productId ||
      !photoSku(row.supplierSku) ||
      !url ||
      (parsedSku && photoSku(parsedSku) !== photoSku(row.supplierSku))
    )
      continue;
    const key = priceImageKey(row.productId, row.supplierSku);
    if (!result.has(key))
      result.set(key, {
        productId: row.productId,
        sku: row.supplierSku!,
        url,
        importId: row.import.id,
        fileName: row.import.fileName,
        rowNumber: row.rowNumber,
      });
  }
  return result;
}
export function priceVariantGroups(
  productId: string,
  variants: Array<{ id: string; sku?: string }>,
  images: Map<string, PriceListImageCandidate>,
): VariantImageGroup[] {
  return variants.flatMap((variant) => {
    const image = images.get(priceImageKey(productId, variant.sku));
    return image && variant.sku
      ? [
          {
            variantId: variant.id,
            sku: variant.sku,
            candidates: [
              {
                url: image.url,
                source: "PRICE_LIST" as const,
                rowNumber: image.rowNumber,
              },
            ],
          },
        ]
      : [];
  });
}
export async function priceListImagesForProducts(
  productIds: string[],
  preferredImportId?: string | null,
) {
  const [images, products] = await Promise.all([
    priceListImagesBySku(productIds, preferredImportId),
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, supplierSku: true, variants: true },
    }),
  ]);
  const result = new Map<string, PriceListImageCandidate>();
  for (const product of products) {
    const exact = images.get(priceImageKey(product.id, product.supplierSku));
    // Never substitute another variant's row for the primary SKU.
    const fallback =
      !normalizeStoredVariants(product.variants).length &&
      !photoSku(product.supplierSku)
        ? [...images.values()].find((image) => image.productId === product.id)
        : undefined;
    if (exact || fallback) result.set(product.id, (exact || fallback)!);
  }
  return result;
}
export async function latestPriceListImageForProduct(
  productId: string,
  preferredImportId?: string | null,
) {
  return (
    (await priceListImagesForProducts([productId], preferredImportId)).get(
      productId,
    ) || null
  );
}
export async function isProductPriceListImage(
  productId: string,
  sourceUrl: string,
) {
  return [...(await priceListImagesBySku([productId])).values()].some(
    (image) => image.url === sourceUrl,
  );
}
