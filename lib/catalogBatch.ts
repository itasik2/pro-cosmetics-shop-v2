import type { CatalogBatch, CatalogCursor, CatalogProductRow, CatalogVariant } from "./catalogTypes";

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
    createdAt: new Date(product.createdAt).toISOString(),
    category: product.category, brand: product.brand ? { name: product.brand.name } : null,
    variants: catalogVariants(product.variants),
  };
}

function compareProducts(a: Pick<CatalogProductRow, "id" | "createdAt">, b: Pick<CatalogProductRow, "id" | "createdAt">) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export function catalogBatch(products: CatalogProductRow[], size: number, cursor?: CatalogCursor, favorites?: readonly string[]): CatalogBatch {
  const ids = favorites ? new Set(favorites) : null;
  const matched = (ids ? products.filter((product) => ids.has(product.id)) : [...products]).sort(compareProducts);
  const nextIndex = cursor ? matched.findIndex((product) => compareProducts(product, cursor) > 0) : 0;
  const start = nextIndex < 0 ? matched.length : nextIndex;
  const cards = matched.slice(start, start + size).map(catalogCard);
  const last = cards.at(-1);
  return { products: cards, total: matched.length, ...(last ? { cursor: { id: last.id, createdAt: last.createdAt } } : {}),
    hasMore: start + cards.length < matched.length };
}
