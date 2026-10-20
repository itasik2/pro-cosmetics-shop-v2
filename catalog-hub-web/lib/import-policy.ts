import type { Existing, Reviewed } from "./import-review";

export type PriceDecision = "AUTO_INCREASE" | "REVIEW_DECREASE" | "REVIEW_FIRST" |
  "REVIEW_IDENTITY" | "REVIEW_SAME_DATE" | "OLDER" | "NO_DATE" | "FUTURE" |
  "REVIEW_OTHER" | "NEW" | "UNCHANGED" | "BLOCKED";

export type ImportPolicyRow = Reviewed & { priceDecision: PriceDecision };
export type MissingPosition = { id: string; sku: string; title: string; stock: number; price: number | null };

export function priceDay(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Almaty", year: "numeric",
    month: "2-digit", day: "2-digit" }).format(now);
}

export function validSourceDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value)) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

function sourceOf(product: Existing) {
  const value = product.attributes?.supplierImport;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function decideImportPrice(row: Reviewed, product: Existing | undefined,
  supplierId: string | null, sourceDate: string | null, now = new Date()): PriceDecision {
  if (row.status === "CREATE" && (typeof row.proposed.price !== "number" || row.proposed.price <= 0 || !row.title)) return "BLOCKED";
  if (row.status === "SAME") {
    const associated = Boolean(supplierId && product?.supplierLinks?.some(link => link.supplierId === supplierId));
    return !associated && supplierId && validSourceDate(sourceDate) && sourceDate <= priceDay(now)
      ? "REVIEW_FIRST" : "UNCHANGED";
  }
  if (row.status === "CREATE" && !validSourceDate(sourceDate)) return "NO_DATE";
  if (row.status === "CREATE" && sourceDate! > priceDay(now)) return "FUTURE";
  if (row.status === "CREATE") return "NEW";
  if (row.status !== "UPDATE" || !product) return "BLOCKED";
  const priceChanges = row.changes.filter(c => c.field === "price" || c.field === "purchasePrice");
  if (!validSourceDate(sourceDate)) return priceChanges.length ? "NO_DATE" : "REVIEW_OTHER";
  if (sourceDate > priceDay(now)) return "FUTURE";
  const provenance = sourceOf(product);
  const priorDate = typeof provenance.sourceDate === "string" ? provenance.sourceDate : null;
  if (validSourceDate(priorDate) && sourceDate < priorDate) return "OLDER";
  if (!priceChanges.length) return "REVIEW_OTHER";
  if (priceChanges.some(c => typeof c.before === "number" && typeof c.after === "number" && c.after < c.before))
    return "REVIEW_DECREASE";
  if (!priceChanges.length || row.changes.some(c => c.field !== "price" && c.field !== "purchasePrice"))
    return "REVIEW_OTHER";
  if (row.matchedBy !== "SKU" || !row.proposed.title ||
      row.sku.trim().toUpperCase() !== product.sku.trim().toUpperCase() ||
      row.title !== product.title || (row.proposed.brand !== undefined && row.proposed.brand !== product.brand))
    return "REVIEW_IDENTITY";
  if (!supplierId || provenance.supplierId !== supplierId ||
      !product.supplierLinks?.some(link => link.supplierId === supplierId &&
        link.supplierSku?.trim().toUpperCase() === row.sku.trim().toUpperCase()))
    return "REVIEW_FIRST";
  if (!validSourceDate(priorDate)) return "REVIEW_FIRST";
  if (sourceDate === priorDate) return "REVIEW_SAME_DATE";
  if (priceChanges.some(c => typeof c.before !== "number" || typeof c.after !== "number"))
    return "REVIEW_FIRST";
  return "AUTO_INCREASE";
}

export function missingSupplierPositions(rows: Reviewed[], products: Existing[], supplierId: string | null,
  sourceDate: string | null): MissingPosition[] {
  // An incomplete, old or undated file cannot prove an item disappeared.
  if (!supplierId || !validSourceDate(sourceDate) || sourceDate > priceDay()) return [];
  const seen = new Set(rows.filter(r => r.sku).map(r => r.sku.trim().toUpperCase()));
  return products.filter(product =>
    (product.supplierLinks?.some(link => link.supplierId === supplierId) || sourceOf(product).supplierId === supplierId) &&
    !seen.has(product.sku.trim().toUpperCase()) &&
    (!validSourceDate(sourceOf(product).sourceDate as string) || sourceDate >= String(sourceOf(product).sourceDate)))
    .map(product => ({ id: product.id, sku: product.sku, title: product.title,
      stock: product.stock ?? 0, price: product.price }));
}
