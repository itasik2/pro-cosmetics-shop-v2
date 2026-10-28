export type CatalogQuery = {
  brandSlugs: string[];
  categorySlugs: string[];
  sort: "" | "new";
  fav: "" | "1";
  instock: "" | "1";
  searchQuery: string;
  care: string;
  maxPrice: number | null;
};

export type CatalogSource = { kind: "catalog"; query: CatalogQuery } | { kind: "brand"; slug: string };

export type CatalogVariant = { id: string; label: string; price: number; stock: number; sku?: string; image?: string };
export type CatalogProductRow = {
  id: string; slug: string; name: string; image: string; shortDescription?: string | null;
  supplierSku?: string | null; price: number; stock: number; isPopular: boolean; isNew?: boolean;
  createdAt: Date | string; category: string; brand?: { name: string } | null; variants?: unknown;
};
export type CatalogCard = Omit<CatalogProductRow, "createdAt" | "variants"> & {
  createdAt: string; variants: CatalogVariant[] | null;
};
export type CatalogCursor = { id: string; createdAt: string };
export type CatalogBatch = { products: CatalogCard[]; total: number; cursor?: CatalogCursor; hasMore: boolean };
export type CatalogBatchRequest = { source: CatalogSource; cursor?: CatalogCursor; favorites: string[] };
