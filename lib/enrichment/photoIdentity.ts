// Client-safe identity snapshots for photos found without a manufacturer SKU.
export type NamePhotoProduct = {
  name?: string;
  brandId?: string | null;
  brand?: { name: string } | null;
  volumeValue?: number | null;
  volumeUnit?: string | null;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isSyntheticSupplierSku(value: unknown) {
  return /^(?:JD|JDR)-[A-Z0-9]{6,}$/i.test(String(value ?? "").trim());
}

export function hasManufacturerSku(value: unknown) {
  return Boolean(String(value ?? "").trim()) && !isSyntheticSupplierSku(value);
}

export function namePhotoKey(
  product: NamePhotoProduct,
  variant?: { label?: string },
) {
  return JSON.stringify([
    normalized(product.name),
    product.brandId || normalized(product.brand?.name),
    product.volumeValue ?? null,
    normalized(product.volumeUnit),
    normalized(
      variant?.label ??
        (product.volumeValue && product.volumeUnit
          ? `${product.volumeValue} ${product.volumeUnit}`
          : ""),
    ),
  ]);
}

export function photoCandidateIsCurrent(
  candidate: { identityKey?: string },
  product: NamePhotoProduct,
  variant?: { label?: string },
) {
  return (
    !candidate.identityKey ||
    candidate.identityKey === namePhotoKey(product, variant)
  );
}

function volumeFree(value: string) {
  return value.replace(
    /\d+(?:[.,]\d+)?\s*(?:мл|ml|гр|г|g|кг|kg|л|l)(?=$|[^\p{L}\p{N}])/giu,
    "",
  );
}

const PHOTO_PRODUCT_TYPES = new Map<string, string>(
  Object.entries({
    крем: "cream",
    кремы: "cream",
    cream: "cream",
    creams: "cream",
    маска: "mask",
    маски: "mask",
    mask: "mask",
    masks: "mask",
    тоник: "toner",
    тонер: "toner",
    toner: "toner",
    toners: "toner",
    эмульсия: "emulsion",
    emulsion: "emulsion",
    emulsions: "emulsion",
    сыворотка: "serum",
    serum: "serum",
    serums: "serum",
    масло: "oil",
    oil: "oil",
    oils: "oil",
    гель: "gel",
    gel: "gel",
    gels: "gel",
    бальзам: "balm",
    balm: "balm",
    balms: "balm",
    флюид: "fluid",
    fluid: "fluid",
    fluids: "fluid",
    пенка: "foam",
    пена: "foam",
    foam: "foam",
    cleanser: "cleanser",
    cleansers: "cleanser",
  }),
);

export function photoNameParts(value: string, brand = "") {
  const words =
    volumeFree(value)
      .toLocaleLowerCase("ru-RU")
      .match(/[\p{L}\p{N}]+/gu) || [];
  return {
    name: normalized(
      words
        .filter((word) => !PHOTO_PRODUCT_TYPES.has(word))
        .map((word) => (word === "днк" ? "dna" : word))
        .join(" "),
    ).replaceAll(normalized(brand), ""),
    types: [
      ...new Set(
        words.flatMap((word) =>
          PHOTO_PRODUCT_TYPES.get(word) ? [PHOTO_PRODUCT_TYPES.get(word)!] : [],
        ),
      ),
    ].sort(),
  };
}

export function samePhotoBrand(left: unknown, right: unknown) {
  return Boolean(normalized(left)) && normalized(left) === normalized(right);
}

function volumes(value: string) {
  const expanded = value.replace(
    /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(мл|ml|гр|г|g|кг|kg|л|l)(?=$|[^\p{L}\p{N}])/giu,
    "$1 $3 / $2 $3",
  );
  return [
    ...expanded.matchAll(
      /(\d+(?:[.,]\d+)?)\s*(мл|ml|гр|г|g|кг|kg|л|l)(?=$|[^\p{L}])/giu,
    ),
  ].map((match) => {
    const unit = match[2].toLowerCase();
    const mass = /^(?:гр|г|g|кг|kg)$/.test(unit);
    const multiplier = /^(?:кг|kg|л|l)$/.test(unit) ? 1000 : 1;
    return `${Number(match[1].replace(",", ".")) * multiplier}:${mass ? "g" : "ml"}`;
  });
}

export function matchesNamedPhotoProduct(
  product: NamePhotoProduct,
  source: {
    title: string | null;
    brand: string | null;
    description: string | null;
    retailer?: string | null;
    confirmedBrand?: string | null;
  },
) {
  const brand = normalized(product.brand?.name);
  if (!brand || !product.name || !source.title) return false;
  const actualBrand = normalized(source.brand);
  const catalogBrandConfirmed = normalized(source.confirmedBrand) === brand;
  const contextualBrand =
    catalogBrandConfirmed ||
    normalized(source.title + " " + source.description).includes(brand);
  // A seller's own name in schema.org brand is not a manufacturer conflict,
  // but it still needs product-specific brand evidence, never the global menu.
  if (
    actualBrand &&
    actualBrand !== brand &&
    (!samePhotoBrand(source.brand, source.retailer) || !catalogBrandConfirmed)
  )
    return false;
  if (!actualBrand && !contextualBrand) return false;
  const expected = photoNameParts(product.name, product.brand?.name);
  const actual = photoNameParts(
    source.title.split(/\||[–—]|\s-\s/)[0],
    product.brand?.name,
  );
  if (
    expected.name.length < 6 ||
    expected.name !== actual.name ||
    expected.types.join(",") !== actual.types.join(",")
  )
    return false;
  const titleVolumes = [...new Set(volumes(source.title))];
  const sourceVolumes = titleVolumes.length
    ? titleVolumes
    : [...new Set(volumes(source.description || ""))];
  // A shared 50/150 ml gallery cannot identify a particular price-list row.
  if (sourceVolumes.length > 1) return false;
  if (product.volumeValue && product.volumeUnit) {
    const unit = normalized(product.volumeUnit);
    const mass = ["г", "гр", "g", "кг", "kg"].includes(unit);
    const multiplier = ["кг", "kg", "л", "l"].includes(unit) ? 1000 : 1;
    if (
      sourceVolumes[0] !==
      `${product.volumeValue * multiplier}:${mass ? "g" : "ml"}`
    )
      return false;
  }
  return true;
}
