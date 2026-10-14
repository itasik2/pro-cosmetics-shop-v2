import type { ImportItem, Table } from "./import-parser";
import type { Mapping } from "./import-types";
import type { Reviewed } from "./import-review";

export const ENRICHMENT_LABELS = {
  brand: "Бренд", description: "Описание", categoryKey: "Категория",
  ingredients: "Состав", application: "Применение", images: "Фотографии",
} as const;
export type EnrichmentField = keyof typeof ENRICHMENT_LABELS;
export function missingEnrichmentFields(card: Record<string, unknown>): EnrichmentField[] {
  return (Object.keys(ENRICHMENT_LABELS) as EnrichmentField[]).filter(field => {
    const value = card[field];
    return field === "images"
      ? !Array.isArray(value) || !value.some(url => typeof url === "string" && /^https?:\/\//.test(url))
      : typeof value !== "string" || !value.trim();
  });
}

// A variant is explicit data from the supplier, never inferred from an AI description.
export function supplierVolume(raw: string) {
  const match = raw.trim().match(/^(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|г|гр|g|кг|kg|шт|уп|упак|рулон)\.?$/i);
  if (!match) return null;
  const units: Record<string, string> = { "мл": "ml", ml: "ml", "л": "l", l: "l", "г": "g", "гр": "g", g: "g", "кг": "kg", kg: "kg", "шт": "pcs", "уп": "pack", "упак": "pack", "рулон": "roll" };
  const value = Number(match[1].replace(",", "."));
  return value > 0 ? { value, unit: units[match[2].toLowerCase()], raw } : null;
}

export function buildUniversalCatalog(input: {
  fileName: string; fileSha256: string; table: Table; mapping: Mapping;
  items: ImportItem[]; review: Reviewed[]; originalRows: Array<Record<string, string>>;
}) {
  const { table, mapping } = input;
  return {
    schema: "catalog-hub/supplier-draft", version: 1,
    purpose: "INTERNAL_REVIEW", // Contains purchase prices; never a marketplace feed.
    source: { fileName: input.fileName, sha256: input.fileSha256, format: table.format },
    products: input.items.map((item, index) => {
      const row = table.rows[index], review = input.review[index];
      const page = row["Страница"] ? Number(row["Страница"]) : null;
      const volume = supplierVolume(item.volume || row["Объем"] || row["Объём"] || row.volume || "");
      const fields = Object.fromEntries(Object.entries(mapping).filter(([, column]) => Boolean(column))
        .map(([field, column]) => [field, { column, raw: row[column!] || "", origin: "SUPPLIER_FILE" }]));
      const supplierSku = mapping.sku ? input.originalRows[index]?.[mapping.sku]?.trim() || null : null;
      const missing = missingEnrichmentFields(item as unknown as Record<string, unknown>);
      return {
        identity: { productId: review.productId, internalSku: item.sku || null, supplierSku, barcode: item.barcode || null },
        card: {
          title: item.title || null, brand: item.brand || null, description: item.description || null,
          categoryKey: item.categoryKey || null, variant: volume,
          ingredients: null, application: null, images: [] as string[],
        },
        prices: { currency: "KZT", purchase: item.purchasePrice ?? null, retail: item.price ?? null,
          sourceAmounts: ["Цена 1", "Цена 2"].filter(column => column in row).map(column => ({
            column, raw: row[column], role: mapping.price === column ? "RETAIL" : mapping.purchasePrice === column ? "PURCHASE" : "UNASSIGNED",
          })) },
        inventory: { supplierQuantity: item.stock ?? null, ownQuantity: null },
        provenance: { rowNumber: item.rowNumber, page: Number.isInteger(page) && page! > 0 ? page : null, fields },
        review: { status: review.status, reasons: review.reasons },
        enrichment: { status: missing.length ? "NEEDS_ENRICHMENT" : "COMPLETE", missingFields: missing,
          searchQuery: [item.brand, item.title, volume?.raw].filter(Boolean).join(" "),
          sourcePriority: ["SUPPLIER_FILE", "OFFICIAL_SITE", "DISTRIBUTOR", "DISCOVERED_WEB"] },
      };
    }),
  };
}
export type UniversalCatalog = ReturnType<typeof buildUniversalCatalog>;
