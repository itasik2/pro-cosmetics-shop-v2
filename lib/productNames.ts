function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export type ProductNameIdentity = {
  name: string;
  supplierSku?: string | null;
  variants?: unknown;
};

/** Display only: identifiers remain in their original fields for matching/search. */
export function productDisplayName(product: ProductNameIdentity) {
  const skus = [product.supplierSku, ...(Array.isArray(product.variants)
    ? product.variants.map((row) => row && typeof row === "object" ? row.sku : null)
    : [])].filter((sku): sku is string => typeof sku === "string" && Boolean(sku.trim()));
  let title = clean(product.name);
  for (const sku of [...new Set(skus)].sort((a, b) => b.length - a.length)) {
    const pattern = [...sku.replace(/\s+/g, "")]
      .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*");
    const end = "(?=$|[^\\p{L}\\p{N}/_.+-])";
    title = title.replace(new RegExp(
      `(^|[^\\p{L}\\p{N}/_.+-])(?:SKU|артикул|арт\\.?)\\s*[:#№-]?\\s*${pattern}${end}`, "giu",
    ), "$1");
    // Short numeric codes can also be volumes, SPF or an ingredient name.
    if ((/[\p{L}]/u.test(sku) && /\d/.test(sku) && sku.length >= 3 &&
      !/^(?:SPF|UV[AB]?|Q|CO)\d+$/i.test(sku)) || /^\d{5,}$/.test(sku))
      title = title.replace(new RegExp(`(^|[^\\p{L}\\p{N}/_.+-])${pattern}${end}`, "giu"), "$1");
  }
  title = title.replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+([,;:])/g, "$1")
    .replace(/(?:\s*[|,;–—]\s*){2,}/g, " ")
    .replace(/^[\s|,;:–—-]+|[\s|,;:–—-]+$/g, "")
    .replace(/\s+/g, " ").trim();
  return formatProductName(title || product.name);
}

function casedLetters(value: string) {
  return [...value].filter(
    (letter) =>
      letter.toLocaleLowerCase("ru-RU") !==
      letter.toLocaleUpperCase("ru-RU"),
  );
}

export function isAllCapsProductName(value: unknown) {
  const name = clean(value);
  const letters = casedLetters(name);
  return Boolean(
    letters.length >= 2 &&
      letters.every(
        (letter) => letter === letter.toLocaleUpperCase("ru-RU"),
      ),
  );
}

const UPPERCASE_TERMS: Record<string, string> = {
  aha: "AHA",
  bha: "BHA",
  bb: "BB",
  cc: "CC",
  co2: "CO2",
  dna: "DNA",
  nmf: "NMF",
  ph: "pH",
  pha: "PHA",
  q10: "Q10",
  rna: "RNA",
  spf: "SPF",
  uv: "UV",
  uva: "UVA",
  uvb: "UVB",
};

function capitalizeFirstLetter(value: string) {
  const letters = [...value];
  const index = letters.findIndex(
    (letter) =>
      letter.toLocaleLowerCase("ru-RU") !==
      letter.toLocaleUpperCase("ru-RU"),
  );
  if (index < 0) return value;
  letters[index] = letters[index].toLocaleUpperCase("ru-RU");
  return letters.join("");
}

export function formatProductName(value: unknown) {
  const name = clean(value);
  if (!isAllCapsProductName(name)) return name;

  let result = name.toLocaleLowerCase("ru-RU");
  result = result.replace(/(?:[a-zа-яё]\.){2,}/giu, (term) =>
    term.toLocaleUpperCase("ru-RU"),
  );
  result = result.replace(/[a-z][a-z0-9]*/gi, (term) => {
    const normalized = term.toLowerCase();
    return (
      UPPERCASE_TERMS[normalized] ||
      `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
    );
  });

  return capitalizeFirstLetter(result);
}
