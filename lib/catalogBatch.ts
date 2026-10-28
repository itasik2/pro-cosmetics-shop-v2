import type { CatalogBatch, CatalogProductRow, CatalogVariant } from "./catalogTypes";

export function catalogVariants(value: unknown): CatalogVariant[] | null {
  if (!Array.isArray(value)) return null;
  const variants: CatalogVariant[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const price = Number(row.price), stock = Number(row.stock);
    if (typeof row.id !== "string" || !row.id || typeof row.label !== "string" || !row.label ||
      !Number.isFinite(price) || !Number.isFinite(stock)) continue;
    variants.push({ id: row.id, label: row.label, price: Math.max(0, Math.trunc(price)), stock: Math.max(0, Math.trunc(stock)),
      ...(typeof row.sku === "string" ? { sku: row.sku } : {}), ...(typeof row.image === "string" ? { image: row.image } : {}) });
  }
  return variants.length ? variants : null;
}

// Explicit projection: grouping fields and supplier/private data never enter the public response.
export function catalogCard(product: CatalogProductRow) {
  return {
    id: product.id, slug: product.slug, name: product.name, image: product.image,
    shortDescription: product.shortDescription, supplierSku: product.supplierSku,
    price: product.price, stock: product.stock, isPopular: product.isPopular, isNew: product.isNew,
    createdAt: product.createdAt instanceof Date ? product.createdAt.toISOString() : product.createdAt,
    category: product.category, brand: product.brand ? { name: product.brand.name } : null,
    variants: catalogVariants(product.variants),
  };
}

export function catalogBatch(products: CatalogProductRow[], size: number, offset = 0, after?: string, favorites?: readonly string[]): CatalogBatch {
  const ids = favorites ? new Set(favorites) : null;
  const matched = ids ? products.filter((product) => ids.has(product.id)) : products;
  const cursorIndex = after ? matched.findIndex((product) => product.id === after) : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : Math.min(Math.max(0, Math.trunc(offset)), matched.length);
  const nextOffset = Math.min(start + size, matched.length);
  return { products: matched.slice(start, nextOffset).map(catalogCard), total: matched.length, nextOffset, hasMore: nextOffset < matched.length };
}
