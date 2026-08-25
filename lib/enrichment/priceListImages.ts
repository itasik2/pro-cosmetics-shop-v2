import { PriceImportStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type PriceListImageCandidate = {
  productId: string;
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

function rowImageUrl(row: { parsedData: unknown; rawData: unknown }) {
  const parsed = jsonObject(row.parsedData);
  const raw = jsonObject(row.rawData);
  const url = String(parsed.priceImageUrl || raw.priceImageUrl || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function normalizeSku(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}

export async function priceListImagesForProducts(
  productIds: string[],
  preferredImportId?: string | null,
) {
  const ids = [...new Set(productIds.map((value) => String(value || "").trim()).filter(Boolean))];
  const result = new Map<string, PriceListImageCandidate>();
  if (!ids.length) return result;

  const [products, rows] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, supplierSku: true },
    }),
    prisma.priceImportRow.findMany({
      where: {
        productId: { in: ids },
        import: {
          status: PriceImportStatus.APPLIED,
          ...(preferredImportId ? { id: preferredImportId } : {}),
        },
      },
      select: {
        productId: true,
        supplierSku: true,
        rowNumber: true,
        parsedData: true,
        rawData: true,
        updatedAt: true,
        import: {
          select: {
            id: true,
            fileName: true,
            appliedAt: true,
          },
        },
      },
      take: 2000,
    }),
  ]);

  const preferredSkuByProduct = new Map(
    products.map((product) => [product.id, normalizeSku(product.supplierSku)]),
  );

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.productId || !rowImageUrl(row)) continue;
    const list = grouped.get(row.productId) || [];
    list.push(row);
    grouped.set(row.productId, list);
  }

  for (const productId of ids) {
    const candidates = grouped.get(productId) || [];
    const preferredSku = preferredSkuByProduct.get(productId) || "";
    candidates.sort((a, b) => {
      const aSku = preferredSku && normalizeSku(a.supplierSku) === preferredSku ? 1 : 0;
      const bSku = preferredSku && normalizeSku(b.supplierSku) === preferredSku ? 1 : 0;
      if (aSku !== bSku) return bSku - aSku;

      const aApplied = a.import.appliedAt?.getTime() || 0;
      const bApplied = b.import.appliedAt?.getTime() || 0;
      if (aApplied !== bApplied) return bApplied - aApplied;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    const row = candidates[0];
    if (!row) continue;
    const url = rowImageUrl(row);
    if (!url) continue;
    result.set(productId, {
      productId,
      url,
      importId: row.import.id,
      fileName: row.import.fileName,
      rowNumber: row.rowNumber,
    });
  }

  return result;
}

export async function latestPriceListImageForProduct(
  productId: string,
  preferredImportId?: string | null,
) {
  const images = await priceListImagesForProducts([productId], preferredImportId);
  return images.get(productId) || null;
}

export async function isProductPriceListImage(productId: string, sourceUrl: string) {
  const target = String(sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(target)) return false;

  const rows = await prisma.priceImportRow.findMany({
    where: {
      productId,
      import: { status: PriceImportStatus.APPLIED },
    },
    select: { parsedData: true, rawData: true },
    take: 200,
  });

  return rows.some((row) => rowImageUrl(row) === target);
}
