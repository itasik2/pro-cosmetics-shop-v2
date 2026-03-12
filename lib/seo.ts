type BrandNameLike = { name: string };

export function buildBrandIntentKeywords(
  brands: BrandNameLike[],
  nouns: string[] = ["крем", "сыворотка", "уход"]
) {
  const uniqueBrands = Array.from(
    new Set(
      brands
        .map((b) => String(b.name || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 12);

  const out: string[] = [];

  for (const brandName of uniqueBrands) {
    out.push(`купить ${brandName}`);
    out.push(`косметика ${brandName}`);

    for (const noun of nouns) {
      out.push(`купить ${noun} ${brandName}`);
    }
  }

  return out;
}

