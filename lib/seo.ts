type BrandNameLike = { name: string };

export function buildBrandIntentKeywords(
  brands: BrandNameLike[],
  nouns: string[] = ["крем", "сыворотка", "уход"],
) {
  const uniqueBrands = Array.from(
    new Set(
      brands
        .map((b) => String(b.name || "").trim())
        .filter(Boolean),
    ),
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

/**
 * Serialize structured data for an inline application/ld+json script without
 * allowing catalog/editorial content to terminate the script element.
 */
export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function seoDescription(value: unknown, maxLength = 160) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}
