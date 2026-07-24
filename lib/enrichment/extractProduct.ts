import * as cheerio from "cheerio";

export type SourceSelectors = {
  title?: string;
  description?: string;
  ingredients?: string;
  application?: string;
  images?: string;
};

export type ExtractedProductData = {
  title: string | null;
  description: string | null;
  sku: string | null;
  brand: string | null;
  canonicalUrl: string | null;
  images: string[];
  ingredients: string | null;
  application: string | null;
  price: number | null;
  currency: string | null;
  rawJsonLd: Record<string, unknown> | null;
};

function cleanText(value: unknown, maxLength = 12_000) {
  const text = typeof value === "string" ? value : "";
  const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function typeIncludesProduct(value: unknown) {
  if (typeof value === "string") return value.toLowerCase() === "product";
  if (Array.isArray(value)) {
    return value.some(
      (item) => typeof item === "string" && item.toLowerCase() === "product",
    );
  }
  return false;
}

function collectJsonLdNodes(value: unknown, output: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdNodes(item, output));
    return;
  }

  const object = toObject(value);
  if (!object) return;

  output.push(object);
  if (Array.isArray(object["@graph"])) {
    collectJsonLdNodes(object["@graph"], output);
  }
}

function parseJsonLdScripts($: cheerio.CheerioAPI) {
  const nodes: Record<string, unknown>[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element).text().replace(/^\uFEFF/, "").trim();
    if (!raw) return;

    try {
      collectJsonLdNodes(JSON.parse(raw), nodes);
    } catch {
      // Невалидный JSON-LD не должен ломать извлечение остальных источников.
    }
  });

  return nodes;
}

function asUrl(value: unknown, baseUrl: string) {
  const raw =
    typeof value === "string"
      ? value
      : cleanText(toObject(value)?.url) || cleanText(toObject(value)?.contentUrl);

  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function collectImageValues(value: unknown, baseUrl: string, output: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageValues(item, baseUrl, output));
    return;
  }

  const url = asUrl(value, baseUrl);
  if (url) output.push(url);
}

function readBrand(value: unknown) {
  if (typeof value === "string") return cleanText(value, 200);
  const object = toObject(value);
  return cleanText(object?.name, 200);
}

function readOffers(value: unknown) {
  const candidates = Array.isArray(value) ? value : [value];

  for (const candidate of candidates) {
    const object = toObject(candidate);
    if (!object) continue;

    const rawPrice = object.price ?? object.lowPrice ?? object.highPrice;
    const price = Number(
      typeof rawPrice === "string" ? rawPrice.replace(",", ".") : rawPrice,
    );
    const currency = cleanText(object.priceCurrency, 10);

    if (Number.isFinite(price) && price >= 0) {
      return { price, currency };
    }
  }

  return { price: null, currency: null };
}

function selectorText(
  $: cheerio.CheerioAPI,
  selector: string | undefined,
  maxLength = 12_000,
) {
  if (!selector) return null;
  try {
    return cleanText($(selector).first().text(), maxLength);
  } catch {
    return null;
  }
}

function selectorImages(
  $: cheerio.CheerioAPI,
  selector: string | undefined,
  baseUrl: string,
) {
  if (!selector) return [] as string[];

  const images: string[] = [];
  try {
    $(selector).each((_, element) => {
      const raw =
        $(element).attr("src") ||
        $(element).attr("data-src") ||
        $(element).attr("href");
      const url = asUrl(raw, baseUrl);
      if (url) images.push(url);
    });
  } catch {
    return [];
  }

  return images;
}

function metaContent($: cheerio.CheerioAPI, selector: string) {
  return cleanText($(selector).first().attr("content"));
}

export function extractProductFromHtml(input: {
  buffer: Buffer;
  finalUrl: string;
  selectors?: SourceSelectors | null;
}): ExtractedProductData {
  const $ = cheerio.loadBuffer(input.buffer);
  const nodes = parseJsonLdScripts($);
  const productNode =
    nodes.find((node) => typeIncludesProduct(node["@type"])) ?? null;

  const selectorTitle = selectorText($, input.selectors?.title, 500);
  const selectorDescription = selectorText(
    $,
    input.selectors?.description,
    12_000,
  );
  const selectorIngredients = selectorText(
    $,
    input.selectors?.ingredients,
    8_000,
  );
  const selectorApplication = selectorText(
    $,
    input.selectors?.application,
    8_000,
  );

  const title =
    selectorTitle ||
    cleanText(productNode?.name, 500) ||
    metaContent($, "meta[property='og:title']") ||
    metaContent($, "meta[name='twitter:title']") ||
    cleanText($("title").first().text(), 500);

  const description =
    selectorDescription ||
    cleanText(productNode?.description) ||
    metaContent($, "meta[property='og:description']") ||
    metaContent($, "meta[name='description']") ||
    metaContent($, "meta[name='twitter:description']");

  const canonicalRaw =
    $("link[rel='canonical']").first().attr("href") ||
    cleanText(productNode?.url, 2_000) ||
    input.finalUrl;
  const canonicalUrl = asUrl(canonicalRaw, input.finalUrl);

  const images: string[] = [];
  collectImageValues(productNode?.image, input.finalUrl, images);
  collectImageValues(
    $("meta[property='og:image']")
      .map((_, element) => $(element).attr("content"))
      .get(),
    input.finalUrl,
    images,
  );
  collectImageValues(
    $("meta[name='twitter:image']")
      .map((_, element) => $(element).attr("content"))
      .get(),
    input.finalUrl,
    images,
  );
  images.push(...selectorImages($, input.selectors?.images, input.finalUrl));

  const offers = readOffers(productNode?.offers);

  return {
    title,
    description,
    sku:
      cleanText(productNode?.sku, 100) ||
      cleanText(productNode?.mpn, 100) ||
      cleanText(productNode?.productID, 100),
    brand: readBrand(productNode?.brand),
    canonicalUrl,
    images: [...new Set(images)].slice(0, 12),
    ingredients:
      selectorIngredients || cleanText(productNode?.ingredients, 8_000),
    application:
      selectorApplication || cleanText(productNode?.usageInfo, 8_000),
    price: offers.price,
    currency: offers.currency,
    rawJsonLd: productNode,
  };
}
