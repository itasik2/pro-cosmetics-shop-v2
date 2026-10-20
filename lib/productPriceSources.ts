import { photoSku } from "./enrichment/variantImages";

export type ProductPriceSource = {
  importId: string;
  fileName: string;
  sourceDate: string | null;
  appliedAt: string;
  skus: string[];
  rowNumbers: number[];
  pageNumbers: number[];
};

type AppliedRow = {
  supplierSku: string | null;
  rowNumber: number;
  pageNumber: number | null;
  appliedAt: Date | null;
  import: {
    id: string;
    fileName: string;
    sourceDate: Date | null;
  };
};

// A matched/uploaded row is not provenance until it has actually been applied.
// Keep the latest applied source for each SKU still present in the card.
export function productPriceSources(
  product: { supplierSku?: string | null; variants?: unknown },
  rows: AppliedRow[],
): ProductPriceSource[] {
  const variantSkus = Array.isArray(product.variants)
    ? product.variants.flatMap((row) =>
        row && typeof row === "object" && "sku" in row && photoSku(row.sku)
          ? [photoSku(row.sku)]
          : [],
      )
    : [];
  const currentSkus = new Set(
    variantSkus.length
      ? variantSkus
      : [photoSku(product.supplierSku)].filter(Boolean),
  );
  const latest = new Map<string, AppliedRow>();
  for (const row of rows) {
    if (!row.appliedAt) continue;
    const sku = photoSku(row.supplierSku);
    if (sku && currentSkus.size && !currentSkus.has(sku)) continue;
    const previous = latest.get(sku);
    const date = row.import.sourceDate?.getTime() ?? 0;
    const previousDate = previous?.import.sourceDate?.getTime() ?? 0;
    if (
      !previous ||
      date > previousDate ||
      (date === previousDate && +row.appliedAt > +previous.appliedAt!)
    )
      latest.set(sku, row);
  }
  const sources = new Map<string, ProductPriceSource>();
  for (const row of latest.values()) {
    let source = sources.get(row.import.id);
    if (!source) {
      source = {
        importId: row.import.id,
        fileName: row.import.fileName,
        sourceDate: row.import.sourceDate?.toISOString() ?? null,
        appliedAt: row.appliedAt!.toISOString(),
        skus: [],
        rowNumbers: [],
        pageNumbers: [],
      };
      sources.set(source.importId, source);
    }
    if (row.supplierSku) source.skus.push(row.supplierSku);
    source.rowNumbers.push(row.rowNumber);
    if (row.pageNumber !== null) source.pageNumbers.push(row.pageNumber);
    if (+row.appliedAt! > +new Date(source.appliedAt))
      source.appliedAt = row.appliedAt!.toISOString();
  }
  return [...sources.values()]
    .map((source) => ({
      ...source,
      skus: [...new Set(source.skus)],
      rowNumbers: [...new Set(source.rowNumbers)].sort((a, b) => a - b),
      pageNumbers: [...new Set(source.pageNumbers)].sort((a, b) => a - b),
    }))
    .sort((a, b) =>
      (b.sourceDate || b.appliedAt).localeCompare(a.sourceDate || a.appliedAt),
    );
}
