type SearchProduct = {
  name: string;
  supplierSku?: string | null;
  variants?: unknown;
  brand?: { name: string } | null;
  supplier?: { name: string } | null;
  category?: string;
  productLineName?: string | null;
  shortDescription?: string | null;
};

function normalized(value: unknown) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/gi, " ").trim();
}

export function productMatchesSearch(product: SearchProduct, query: string) {
  const tokens = normalized(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const haystack = normalized([
    product.name, product.supplierSku, product.brand?.name, product.supplier?.name,
    product.category, product.productLineName, product.shortDescription,
    ...variants.flatMap((row) => row && typeof row === "object" ? [row.sku, row.label] : []),
  ].filter(Boolean).join(" "));
  return tokens.every((token) => haystack.includes(token));
}
