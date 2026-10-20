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
  },
) {
  const brand = normalized(product.brand?.name);
  if (!brand || !product.name || !source.title) return false;
  const actualBrand = normalized(source.brand);
  if (actualBrand && actualBrand !== brand) return false;
  if (
    !actualBrand &&
    !normalized(source.title + " " + source.description).includes(brand)
  )
    return false;
  const expected = normalized(volumeFree(product.name)).replaceAll(brand, "");
  const actual = normalized(
    volumeFree(source.title).split(/\||[–—]|\s-\s/)[0],
  ).replaceAll(brand, "");
  if (expected.length < 6 || expected !== actual) return false;
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
