import type { ExtractedProductData } from "./extractProduct";

export type MatchableProduct = {
  name: string;
  supplierSku: string | null;
  barcode: string | null;
  volumeValue: number | null;
  volumeUnit: string | null;
  brand: { name: string } | null;
  supplier: { name: string } | null;
};

export type ProductMatchResult = {
  confidence: number;
  warnings: string[];
  evidence: {
    sku: "match" | "mismatch" | "missing";
    brand: "match" | "mismatch" | "missing";
    volume: "match" | "mismatch" | "missing";
    nameSimilarity: number;
  };
};

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9%]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown) {
  return normalize(value).replace(/\s+/g, "");
}

function tokenSet(value: string) {
  const ignored = new Set([
    "для",
    "лица",
    "кожи",
    "и",
    "с",
    "the",
    "of",
    "ml",
    "мл",
  ]);

  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length >= 2 && !ignored.has(token)),
  );
}

function jaccardSimilarity(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;

  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function parseVolumeFromText(value: string) {
  const text = normalize(value);
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|г|гр|g)\b/i);
  if (!match) return null;

  const amount = Math.round(Number(match[1].replace(",", ".")));
  const rawUnit = match[2].toLowerCase();
  const unit = rawUnit === "мл" || rawUnit === "ml" ? "ml" : "g";
  return Number.isFinite(amount) ? { amount, unit } : null;
}

function expectedBrand(product: MatchableProduct) {
  return product.brand?.name || product.supplier?.name || "";
}

export function scoreProductMatch(
  product: MatchableProduct,
  extracted: ExtractedProductData,
): ProductMatchResult {
  let score = 0;
  const warnings: string[] = [];

  const expectedSku = compact(product.supplierSku || product.barcode);
  const foundSku = compact(extracted.sku);
  let sku: ProductMatchResult["evidence"]["sku"] = "missing";

  if (expectedSku && foundSku) {
    if (expectedSku === foundSku) {
      score += 50;
      sku = "match";
    } else {
      score -= 80;
      sku = "mismatch";
      warnings.push("sku_mismatch");
    }
  } else if (expectedSku) {
    warnings.push("source_sku_missing");
  }

  const expectedBrandValue = normalize(expectedBrand(product));
  const foundBrand = normalize(extracted.brand);
  let brand: ProductMatchResult["evidence"]["brand"] = "missing";

  if (expectedBrandValue && foundBrand) {
    if (
      foundBrand.includes(expectedBrandValue) ||
      expectedBrandValue.includes(foundBrand)
    ) {
      score += 20;
      brand = "match";
    } else {
      score -= 100;
      brand = "mismatch";
      warnings.push("brand_mismatch");
    }
  } else if (expectedBrandValue) {
    warnings.push("source_brand_missing");
  }

  const foundVolume = parseVolumeFromText(
    `${extracted.title || ""} ${extracted.description || ""}`,
  );
  let volume: ProductMatchResult["evidence"]["volume"] = "missing";

  if (product.volumeValue && product.volumeUnit && foundVolume) {
    if (
      product.volumeValue === foundVolume.amount &&
      normalize(product.volumeUnit) === normalize(foundVolume.unit)
    ) {
      score += 15;
      volume = "match";
    } else {
      score -= 40;
      volume = "mismatch";
      warnings.push("volume_mismatch");
    }
  } else if (product.volumeValue) {
    warnings.push("source_volume_missing");
  }

  const nameSimilarity = jaccardSimilarity(
    product.name,
    extracted.title || extracted.description || "",
  );
  score += Math.round(nameSimilarity * 15);
  if (nameSimilarity < 0.35) warnings.push("low_name_similarity");

  if (!extracted.description) warnings.push("description_missing");
  if (!extracted.images.length) warnings.push("images_missing");

  return {
    confidence: Math.max(0, Math.min(100, score)),
    warnings: [...new Set(warnings)],
    evidence: { sku, brand, volume, nameSimilarity },
  };
}
