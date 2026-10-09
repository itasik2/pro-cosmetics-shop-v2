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

function compact(value: unknown) {
  return normalize(value).replace(/\s+/g, "");
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

function parseVolumes(value: string) {
  const result = new Set<string>();
  for (const match of normalize(value).matchAll(/(\d+(?:[.,]\d+)?)\s*(мл|ml|г|гр|g)\b/gi)) {
    const amount = Math.round(Number(match[1].replace(",", ".")));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const unit = /мл|ml/i.test(match[2]) ? "ml" : "g";
    result.add(`${amount}:${unit}`);
  }
  return result;
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

  const expectedSku = compact(product.sku || product.barcode);
  const foundSku = compact(extracted.sku);
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
  if (product.volumeValue && product.volumeUnit) {
    const unit = /мл|ml/i.test(product.volumeUnit) ? "ml" : /г|гр|g/i.test(product.volumeUnit) ? "g" : "";
    if (unit) {
      const expected = `${Math.round(product.volumeValue)}:${unit}`;
      const sourceVolumes = new Set([
        ...parseVolumes(extracted.title || ""),
        ...parseVolumes(extracted.description || ""),
      ]);
      if (sourceVolumes.has(expected)) {
        score += 10;
        volume = "match";
      } else if (sourceVolumes.size) {
        score -= 30;
        volume = "mismatch";
        warnings.push("volume_mismatch");
      } else {
        warnings.push("source_volume_missing");
      }
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
