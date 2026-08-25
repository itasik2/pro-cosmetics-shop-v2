import type { ExtractedProductData } from "./extractProduct";

export type MatchableProduct = {
  name: string;
  category?: string | null;
  productLineName?: string | null;
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

function isInternalSyntheticSku(value: unknown) {
  return /^JD-[A-Z0-9]{6,}$/i.test(String(value || "").trim());
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

type ParsedVolume = { amount: number; unit: "ml" | "g" };

function volumeKey(volume: ParsedVolume) {
  return `${volume.amount}:${volume.unit}`;
}

function parseVolumesFromText(value: string) {
  const text = normalize(value);
  const volumes = new Map<string, ParsedVolume>();
  const pattern = /(\d+(?:[.,]\d+)?)\s*(мл|ml|г|гр|g)\b/gi;

  for (const match of text.matchAll(pattern)) {
    const amount = Math.round(Number(match[1].replace(",", ".")));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const rawUnit = match[2].toLowerCase();
    const unit: ParsedVolume["unit"] =
      rawUnit === "мл" || rawUnit === "ml" ? "ml" : "g";
    const volume = { amount, unit };
    volumes.set(volumeKey(volume), volume);
  }

  return [...volumes.values()];
}

function normalizedVolumeUnit(value: unknown): ParsedVolume["unit"] | null {
  const unit = normalize(value);
  if (unit === "мл" || unit === "ml") return "ml";
  if (unit === "г" || unit === "гр" || unit === "g") return "g";
  return null;
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

  const nameSimilarity = jaccardSimilarity(
    product.name,
    extracted.title || extracted.description || "",
  );
  score += Math.round(nameSimilarity * 15);
  if (nameSimilarity < 0.35) warnings.push("low_name_similarity");

  const syntheticSupplierSku = isInternalSyntheticSku(product.supplierSku);
  const expectedSku = compact(
    syntheticSupplierSku
      ? product.barcode
      : product.supplierSku || product.barcode,
  );
  const foundSku = compact(extracted.sku);
  let sku: ProductMatchResult["evidence"]["sku"] = "missing";

  if (syntheticSupplierSku) {
    warnings.push("internal_sku_ignored_for_matching");
  }

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

  const expectedVolumeUnit = normalizedVolumeUnit(product.volumeUnit);
  const expectedVolume =
    product.volumeValue && expectedVolumeUnit
      ? { amount: product.volumeValue, unit: expectedVolumeUnit }
      : null;
  const titleVolumes = parseVolumesFromText(extracted.title || "");
  const descriptionVolumes = parseVolumesFromText(extracted.description || "");
  const allVolumes = new Map<string, ParsedVolume>();
  [...titleVolumes, ...descriptionVolumes].forEach((volume) =>
    allVolumes.set(volumeKey(volume), volume),
  );
  let volume: ProductMatchResult["evidence"]["volume"] = "missing";

  if (expectedVolume) {
    const expectedKey = volumeKey(expectedVolume);
    if (allVolumes.has(expectedKey)) {
      score += 15;
      volume = "match";
    } else if (titleVolumes.length > 0) {
      score -= 40;
      volume = "mismatch";
      warnings.push("volume_mismatch");
    } else if (descriptionVolumes.length === 1) {
      score -= 25;
      volume = "mismatch";
      warnings.push("volume_mismatch");
    } else if (descriptionVolumes.length > 1) {
      warnings.push("source_volume_ambiguous");
    } else {
      warnings.push("source_volume_missing");
    }
  }

  const expectedBrandValue = normalize(expectedBrand(product));
  const structuredBrand = normalize(extracted.brand);
  const sourceText = normalize(
    `${extracted.title || ""} ${extracted.description || ""}`,
  );
  let brand: ProductMatchResult["evidence"]["brand"] = "missing";

  if (expectedBrandValue) {
    if (
      sourceText.includes(expectedBrandValue) ||
      (structuredBrand &&
        (structuredBrand.includes(expectedBrandValue) ||
          expectedBrandValue.includes(structuredBrand)))
    ) {
      score += 20;
      brand = "match";
    } else if (structuredBrand) {
      brand = "mismatch";
      warnings.push("brand_mismatch");

      // У некоторых магазинов JSON-LD brand ошибочно содержит бренд магазина.
      // Если название почти точное и объём подтверждён, оставляем карточку
      // на ручную проверку вместо ложного 0%.
      if (nameSimilarity >= 0.7 && volume === "match") {
        score -= 10;
        warnings.push("brand_metadata_conflict");
      } else {
        score -= 100;
      }
    } else {
      warnings.push("source_brand_missing");
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
