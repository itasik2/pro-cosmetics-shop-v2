import { photoSku, productVolumes, volumeKey } from "./photo-identity.js";
import type { CatalogProductInput, ExtractedProductData } from "./types.js";

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9%]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  const ignored = new Set(["для", "лица", "кожи", "и", "с", "the", "of", "ml", "мл"]);
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length >= 2 && !ignored.has(token)),
  );
}

function jaccard(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

export function scoreProductMatch(
  product: CatalogProductInput,
  extracted: ExtractedProductData,
) {
  let score = 0;
  const warnings: string[] = [];

  const nameSimilarity = jaccard(
    product.title,
    extracted.title || extracted.description || "",
  );
  score += Math.round(nameSimilarity * 20);
  if (nameSimilarity < 0.35) warnings.push("low_name_similarity");

  // Price imports assign an internal SKU. An official product code can differ
  // without indicating that this is another product.
  const expectedSku = product.skuIsInternal ? "" : photoSku(product.sku);
  const foundSku = photoSku(extracted.sku);
  let sku: "match" | "mismatch" | "missing" = "missing";
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

  const expectedBrand = normalize(product.brand);
  const foundBrand = normalize(extracted.brand);
  const sourceText = normalize(`${extracted.title || ""} ${extracted.description || ""}`);
  let brand: "match" | "mismatch" | "missing" = "missing";

  if (expectedBrand) {
    if (
      sourceText.includes(expectedBrand) ||
      (foundBrand &&
        (foundBrand.includes(expectedBrand) || expectedBrand.includes(foundBrand)))
    ) {
      score += 20;
      brand = "match";
    } else if (foundBrand) {
      score -= 50;
      brand = "mismatch";
      warnings.push("brand_mismatch");
    } else {
      warnings.push("source_brand_missing");
    }
  }

  let volume: "match" | "mismatch" | "missing" = "missing";
  const expected = product.volumeValue && product.volumeUnit
    ? volumeKey(product.volumeValue, product.volumeUnit) : null;
  if (expected) {
    const titleVolumes = productVolumes(extracted.title || "");
    const sourceVolumes = titleVolumes.length ? titleVolumes : productVolumes(extracted.description || "");
    if (sourceVolumes.length === 1 && sourceVolumes[0] === expected) {
      score += 10;
      volume = "match";
    } else if (sourceVolumes.length && !sourceVolumes.includes(expected)) {
      score -= 30;
      volume = "mismatch";
      warnings.push("volume_mismatch");
    } else {
      warnings.push(sourceVolumes.length ? "source_volume_ambiguous" : "source_volume_missing");
    }
  }

  if (!extracted.description) warnings.push("description_missing");
  if (!extracted.images.length) warnings.push("images_missing");

  return {
    confidence: Math.max(0, Math.min(100, score)),
    warnings: [...new Set(warnings)],
    evidence: { sku, brand, volume, nameSimilarity },
  };
}
