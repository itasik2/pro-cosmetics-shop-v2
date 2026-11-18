export type PhotoProduct = {
  sku: string;
  skuIsInternal?: boolean;
  title: string;
  brand?: string | null;
  volumeValue?: number | null;
  volumeUnit?: string | null;
};

export function photoSku(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

export function isInternalPhotoSku(value: unknown) {
  return /^(?:(?:JD|JDR)-[A-Z0-9]{6,}|INT-PRICE-[A-F0-9]{12})$/i.test(String(value ?? "").trim());
}

export function photoIdentityKey(product: PhotoProduct) {
  return JSON.stringify([photoSku(product.sku), product.title.trim(), product.brand?.trim() || "",
    product.volumeValue ?? null, product.volumeUnit?.trim().toLowerCase() || ""]);
}

export function volumeKey(amount: number, unit: string) {
  const normalized = unit.toLowerCase().replace(/\.$/, "");
  if (!/^(?:мл|ml|л|l|г|гр|g|кг|kg)$/.test(normalized) || !Number.isFinite(amount) || amount <= 0) return null;
  const multiplier = /^(?:л|l|кг|kg)$/.test(normalized) ? 1000 : 1;
  const value = Number((amount * multiplier).toPrecision(12));
  return value + ":" + (/^(?:г|гр|g|кг|kg)$/.test(normalized) ? "g" : "ml");
}

export function productVolumes(value: string) {
  const expanded = value.normalize("NFKC").replace(
    /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(мл|ml|гр|г|g|кг|kg|л|l)(?=$|[^\p{L}\p{N}])/giu,
    "$1 $3 / $2 $3",
  );
  const keys = [...expanded.matchAll(/(\d+(?:[.,]\d+)?)\s*(мл|ml|гр|г|g|кг|kg|л|l)(?=$|[^\p{L}\p{N}])/giu)]
    .map(match => volumeKey(Number(match[1].replace(",", ".")), match[2]));
  return [...new Set(keys.filter((key): key is string => key !== null))];
}

export function photoHasVariants(node: Record<string, unknown>) {
  const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
  return Boolean(node.hasVariant) || offers.some(value => {
    const offer = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return Number(offer.offerCount) > 1 || Boolean(offer.sku && photoSku(offer.sku) !== photoSku(node.sku));
  }) || (offers.length > 1 && offers.some(offer => !offer?.sku));
}

function nameKey(value: string) {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/ё/g, "е")
    .replace(/\d+(?:[.,]\d+)?\s*(?:мл|ml|гр|г|g|кг|kg|л|l)(?=$|[^\p{L}\p{N}])/giu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function productPhotoIssue(product: PhotoProduct, source: {
  sku?: string | null;
  title?: string | null;
  brand?: string | null;
  description?: string | null;
  hasVariants?: boolean;
}) {
  const expectedSku = product.skuIsInternal || isInternalPhotoSku(product.sku) ? "" : photoSku(product.sku);
  const foundSku = photoSku(source.sku);
  if (expectedSku && foundSku && expectedSku !== foundSku) return "photo_sku_mismatch";
  const exactSku = Boolean(expectedSku && foundSku === expectedSku);
  const expectedBrand = nameKey(product.brand || "");
  const foundBrand = nameKey(source.brand || "");
  if (expectedBrand && foundBrand && expectedBrand !== foundBrand) return "photo_brand_mismatch";
  const brandConfirmed = foundBrand === expectedBrand ||
    (!foundBrand && Boolean(expectedBrand) && nameKey(source.title || "").includes(expectedBrand));
  if ((expectedBrand && !brandConfirmed) || (!exactSku && !expectedBrand)) return "photo_brand_unconfirmed";
  const explicitVolume = product.volumeValue && product.volumeUnit
    ? volumeKey(product.volumeValue, product.volumeUnit) : null;
  const requestedVolumes = explicitVolume ? [explicitVolume] : productVolumes(product.title);
  if (requestedVolumes.length > 1) return "photo_volume_ambiguous";
  const requestedVolume = requestedVolumes[0] ?? null;
  const titleVolumes = productVolumes(source.title || "");
  const volumes = titleVolumes.length ? titleVolumes : productVolumes(source.description || "");
  if (requestedVolume && volumes.length && !volumes.includes(requestedVolume)) return "photo_volume_mismatch";
  if (volumes.length > 1 || source.hasVariants) return "photo_volume_ambiguous";
  if (exactSku) return null;
  if (!requestedVolume && volumes.length) return "photo_volume_unconfirmed";
  if (requestedVolume && volumes[0] !== requestedVolume) return "photo_volume_unconfirmed";
  const expectedName = nameKey(product.title).replaceAll(expectedBrand, "");
  const foundName = nameKey(source.title || "").replaceAll(expectedBrand, "");
  if (expectedName.length < 3 || expectedName !== foundName) return "photo_name_mismatch";
  return null;
}
