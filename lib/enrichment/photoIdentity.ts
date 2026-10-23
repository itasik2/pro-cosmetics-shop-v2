// Client-safe identity snapshots for photos found without a manufacturer SKU.
export type NamePhotoProduct = {
  name?: string;
  brandId?: string | null;
  brand?: { name: string } | null;
  volumeValue?: number | null;
  volumeUnit?: string | null;
  packageLabel?: string | null;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function photoComparisonText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е");
}

export function isSyntheticSupplierSku(value: unknown) {
  const sku = String(value ?? "").trim();
  return (
    /^(?:JD|JDR)-[A-Z0-9]{6,}$/i.test(sku) ||
    /^INT-PRICE-[A-F0-9]{12}$/i.test(sku)
  );
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
    photoComparisonText(volumeFree(value)).match(/[\p{L}\p{N}]+/gu) || [];
  const tokens = words
    .filter((word) => !PHOTO_PRODUCT_TYPES.has(word))
    .map((word) => (word === "днк" ? "dna" : word));
  const brandKey = normalized(photoComparisonText(brand));
  // Remove the complete brand, including spaced spellings such as Jeu Derm.
  for (let start = 0; brandKey && start < tokens.length; start++) {
    for (let end = start + 1; end <= tokens.length; end++) {
      const part = tokens.slice(start, end).join("");
      if (part === brandKey) {
        tokens.splice(start, end - start);
        start--;
        break;
      }
      if (part.length >= brandKey.length) break;
    }
  }
  return {
    name: normalized(tokens.join(" ")).replaceAll(brandKey, ""),
    tokens,
    types: [
      ...new Set(
        words.flatMap((word) =>
          PHOTO_PRODUCT_TYPES.get(word) ? [PHOTO_PRODUCT_TYPES.get(word)!] : [],
        ),
      ),
    ].sort(),
  };
}

function wipeSetName(value: string) {
  return photoComparisonText(value)
    .replace(/(?<!\p{L})[pр][hн][aа](?!\p{L})/gu, "pha")
    .replace(/(?<!\p{L})набор(?!\p{L})/gu, "")
    .replace(/для\s+кожи/gu, "")
    .replace(/пилинг[\s-]+салфет(?:ок|ки|ка)(?!\p{L})/gu, "пилинг-салфетки")
    .replace(/\d+\s*[хx×*]\s*\d+(?:[.,]\d+)?\s*(?:мл|ml)/gu, "")
    .replace(/\d+\s*шт\.?/gu, "");
}

function wipeSetMatches(product: NamePhotoProduct, source: { title: string; singleProduct?: boolean }) {
  if (!source.singleProduct || !/пилинг[\s-]+салфет/iu.test(product.name || "") ||
    !/пилинг[\s-]+салфет/iu.test(source.title)) return false;
  const expected = product.packageLabel?.match(/(\d+)\s*[хx×*]\s*(\d+(?:[.,]\d+)?)\s*(мл|ml)/iu);
  if (!expected || Number(expected[1]) < 2 || Number(expected[2].replace(",", ".")) !== product.volumeValue ||
    !/^(?:мл|ml)$/iu.test(product.volumeUnit || "")) return false;
  const actual = [...source.title.matchAll(/(?<!\d)(\d+)\s*(?:шт\.?|[хx×*]\s*\d+(?:[.,]\d+)?\s*(?:мл|ml))(?!\p{L})/giu)];
  if (actual.length !== 1 || Number(actual[0][1]) !== Number(expected[1])) return false;
  const left = photoNameParts(wipeSetName(product.name || ""), product.brand?.name);
  const right = photoNameParts(wipeSetName(source.title), product.brand?.name);
  return left.name.length >= 10 && left.name === right.name;
}

export function samePhotoBrand(left: unknown, right: unknown) {
  const key = normalized(photoComparisonText(left));
  return Boolean(key) && key === normalized(photoComparisonText(right));
}

function oneExtraLetter(left: string, right: string) {
  const [short, long] =
    left.length < right.length ? [left, right] : [right, left];
  if (long.length !== short.length + 1) return false;
  let index = 0;
  while (index < short.length && short[index] === long[index]) index++;
  return short.slice(index) === long.slice(index + 1);
}

function matchesPhotoNameTypo(
  expected: ReturnType<typeof photoNameParts>,
  actual: ReturnType<typeof photoNameParts>,
) {
  if (
    expected.name.length < 12 ||
    !expected.types.length ||
    expected.tokens.length < 3 ||
    expected.tokens.length !== actual.tokens.length
  )
    return false;
  const changed = expected.tokens.flatMap((word, i) =>
    word !== actual.tokens[i] ? [i] : [],
  );
  if (changed.length !== 1) return false;
  const index = changed[0];
  const stable = expected.tokens.filter((_, i) => i !== index);
  if (new Set(stable).size < 2 || !stable.some((word) => word.length >= 4))
    return false;
  const left = expected.tokens[index];
  const right = actual.tokens[index];
  // Never fuzz short model codes, numbers, forms or word substitutions.
  return (
    Math.min(left.length, right.length) >= 6 &&
    /^[\p{L}]+$/u.test(left + right) &&
    oneExtraLetter(left, right)
  );
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

const PHOTO_COLORS: Array<[string, RegExp]> = [
  ["gray", /^(?:серый|серая|серое|серые|gray|grey)$/u],
  ["white", /^(?:белый|белая|белое|белые|white)$/u],
  ["black", /^(?:черный|черная|черное|черные|black)$/u],
  ["blue", /^(?:синий|синяя|синее|синие|blue)$/u],
  ["red", /^(?:красный|красная|красное|красные|red)$/u],
  ["green", /^(?:зеленый|зеленая|зеленое|зеленые|green)$/u],
  ["pink", /^(?:розовый|розовая|розовое|розовые|pink)$/u],
  ["beige", /^(?:бежевый|бежевая|бежевое|бежевые|beige)$/u],
];
function photoColor(value: string) {
  const color = photoComparisonText(value).trim();
  return PHOTO_COLORS.find(([, pattern]) => pattern.test(color))?.[0] || null;
}

function matchesPhotoColorAttribute(
  expected: ReturnType<typeof photoNameParts>,
  actual: ReturnType<typeof photoNameParts>,
  source: { color?: string | null; singleProduct?: boolean },
) {
  if (!source.singleProduct || !source.color) return false;
  const requested = expected.tokens.filter((word) => photoColor(word));
  const actualColors = actual.tokens.filter((word) => photoColor(word));
  if (
    requested.length !== 1 ||
    photoColor(requested[0]) !== photoColor(source.color) ||
    actualColors.length > 1 ||
    actualColors.some((word) => photoColor(word) !== photoColor(requested[0]))
  )
    return false;
  const core = (tokens: string[]) =>
    tokens.filter((word) => !photoColor(word)).join("");
  const expectedCore = core(expected.tokens);
  return expectedCore.length >= 3 && expectedCore === core(actual.tokens);
}

export function namedPhotoProductIssue(
  product: NamePhotoProduct,
  source: {
    title: string | null;
    brand: string | null;
    description: string | null;
    retailer?: string | null;
    confirmedBrand?: string | null;
    color?: string | null;
    singleProduct?: boolean;
  },
) {
  const brand = normalized(photoComparisonText(product.brand?.name));
  if (!brand || !product.name || !source.title) return "photo_identity_missing";
  const actualBrand = normalized(photoComparisonText(source.brand));
  const catalogBrandConfirmed =
    normalized(photoComparisonText(source.confirmedBrand)) === brand;
  const contextualBrand =
    catalogBrandConfirmed ||
    normalized(
      photoComparisonText(source.title + " " + source.description),
    ).includes(brand);
  // A seller's own name in schema.org brand is not a manufacturer conflict,
  // but it still needs product-specific brand evidence, never the global menu.
  if (
    actualBrand &&
    actualBrand !== brand &&
    (!samePhotoBrand(source.brand, source.retailer) || !catalogBrandConfirmed)
  )
    return "photo_brand_unconfirmed";
  if (!actualBrand && !contextualBrand) return "photo_brand_unconfirmed";
  const expected = photoNameParts(product.name, product.brand?.name);
  const actual = photoNameParts(
    source.title.split(/\||[–—]|\s-\s/)[0],
    product.brand?.name,
  );
  const matchingWipeSet = wipeSetMatches(product, { ...source, title: source.title });
  if (
    expected.name.length < 3 ||
    (expected.name.length < 6 && !source.singleProduct) ||
    expected.types.join(",") !== actual.types.join(",")
  )
    return "photo_name_mismatch";
  const requestedColors = expected.tokens.flatMap((word) =>
    photoColor(word) ? [photoColor(word)!] : [],
  );
  if (
    requestedColors.length && source.color &&
    (requestedColors.length !== 1 || requestedColors[0] !== photoColor(source.color))
  )
    return "photo_color_mismatch";
  if (
    expected.name !== actual.name &&
    !matchingWipeSet &&
    !matchesPhotoColorAttribute(expected, actual, source) &&
    !(
      (actualBrand === brand || catalogBrandConfirmed) &&
      product.volumeValue &&
      product.volumeUnit &&
      matchesPhotoNameTypo(expected, actual)
    )
  )
    return "photo_name_mismatch";
  const titleVolumes = [...new Set(volumes(source.title))];
  const sourceVolumes = titleVolumes.length
    ? titleVolumes
    : [...new Set(volumes(source.description || ""))];
  // A shared 50/150 ml gallery cannot identify a particular price-list row.
  if (sourceVolumes.length > 1) return "photo_volume_ambiguous";
  if (product.volumeValue && product.volumeUnit) {
    const unit = normalized(product.volumeUnit);
    const mass = ["г", "гр", "g", "кг", "kg"].includes(unit);
    const multiplier = ["кг", "kg", "л", "l"].includes(unit) ? 1000 : 1;
    if (
      !(matchingWipeSet && !sourceVolumes.length) && sourceVolumes[0] !==
      `${product.volumeValue * multiplier}:${mass ? "g" : "ml"}`
    )
      return "photo_volume_mismatch";
  }
  return null;
}

export function matchesNamedPhotoProduct(
  product: NamePhotoProduct,
  source: Parameters<typeof namedPhotoProductIssue>[1],
) {
  return namedPhotoProductIssue(product, source) === null;
}
