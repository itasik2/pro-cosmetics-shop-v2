import * as cheerio from "cheerio";
import type { ExtractedProductData } from "./types.js";

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

function collectNodes(value: unknown, output: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectNodes(item, output));
    return;
  }
  const object = toObject(value);
  if (!object) return;
  output.push(object);
  if (Array.isArray(object["@graph"])) collectNodes(object["@graph"], output);
}

function productNode(nodes: Record<string, unknown>[]) {
  return (
    nodes.find((node) => {
      const type = node["@type"];
      return Array.isArray(type)
        ? type.some((item) => String(item).toLowerCase() === "product")
        : String(type || "").toLowerCase() === "product";
    }) ?? null
  );
}

function asUrl(value: unknown, baseUrl: string) {
  const object = toObject(value);
  const raw =
    typeof value === "string"
      ? value
      : cleanText(object?.url) || cleanText(object?.contentUrl);
  if (!raw) return null;

  try {
    const url = new URL(raw, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function collectImages(value: unknown, baseUrl: string, output: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectImages(item, baseUrl, output));
    return;
  }
  const url = asUrl(value, baseUrl);
  if (url) output.push(url);
}

function readBrand(value: unknown) {
  if (typeof value === "string") return cleanText(value, 200);
  return cleanText(toObject(value)?.name, 200);
}

function readOffer(value: unknown) {
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    const object = toObject(item);
    if (!object) continue;
    const rawPrice = object.price ?? object.lowPrice ?? object.highPrice;
    const price = Number(
      typeof rawPrice === "string" ? rawPrice.replace(",", ".") : rawPrice,
    );
    if (Number.isFinite(price) && price > 0) {
      return {
        price,
        currency: cleanText(object.priceCurrency, 10),
      };
    }
  }
  return { price: null, currency: null };
}

function labeledSection(
  body: string,
  labels: string[],
  endLabels: string[],
  maxLength: number,
) {
  const normalized = body.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  let start = -1;
  let markerLength = 0;

  for (const label of labels) {
    const token = label.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
    const index = normalized.indexOf(token);
    if (index >= 0 && (start < 0 || index < start)) {
      start = index;
      markerLength = token.length;
    }
  }
  if (start < 0) return null;

  const contentStart = start + markerLength;
  let end = body.length;
  for (const label of endLabels) {
    const index = normalized.indexOf(
      label.toLocaleLowerCase("ru-RU").replace(/ё/g, "е"),
      contentStart,
    );
    if (index >= contentStart && index < end) end = index;
  }
  return cleanText(body.slice(contentStart, end), maxLength);
}

function likelyImage(value: string) {
  const normalized = value.toLowerCase();
  if (/\.(?:svg|gif)(?:$|[?#])/.test(normalized)) return false;
  return !/(?:logo|icon|sprite|loader|spinner|banner|avatar|payment|social|captcha)/i.test(
    normalized,
  );
}

export function extractProductFromHtml(input: {
  buffer: Buffer;
  finalUrl: string;
}): ExtractedProductData {
  const html = input.buffer.toString("utf8");
  const $ = cheerio.load(html);
  const nodes: Record<string, unknown>[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element).text().replace(/^\uFEFF/, "").trim();
    if (!raw) return;
    try {
      collectNodes(JSON.parse(raw), nodes);
    } catch {
      // One invalid JSON-LD block must not break the rest of the page.
    }
  });

  const product = productNode(nodes);
  const body = cleanText($("body").text(), 200_000) || "";

  const title =
    cleanText(product?.name, 500) ||
    cleanText($("meta[property='og:title']").attr("content"), 500) ||
    cleanText($("h1").first().text(), 500);

  const description =
    cleanText(product?.description) ||
    cleanText($("meta[name='description']").attr("content")) ||
    cleanText($("meta[property='og:description']").attr("content"));

  const images: string[] = [];
  collectImages(product?.image, input.finalUrl, images);

  const ogImage = asUrl(
    $("meta[property='og:image']").attr("content"),
    input.finalUrl,
  );
  if (ogImage) images.push(ogImage);

  $("img").each((_, element) => {
    const raw =
      $(element).attr("src") ||
      $(element).attr("data-src") ||
      $(element).attr("data-large-img-url");
    const url = asUrl(raw, input.finalUrl);
    if (url && likelyImage(url)) images.push(url);
  });

  const canonicalUrl =
    asUrl($("link[rel='canonical']").attr("href"), input.finalUrl) ||
    input.finalUrl;

  const offers = readOffer(product?.offers);
  const application = labeledSection(
    body,
    ["способ применения:", "способ применения"],
    ["состав", "ингредиенты", "характеристики", "описание"],
    8_000,
  );
  const ingredients =
    labeledSection(
      body,
      ["состав:", "состав", "ingredients:", "ingredients"],
      ["способ применения", "характеристики", "описание"],
      8_000,
    ) || null;

  return {
    title,
    description,
    sku:
      cleanText(product?.sku, 100) ||
      cleanText(product?.mpn, 100) ||
      cleanText(product?.productID, 100),
    brand: readBrand(product?.brand),
    canonicalUrl,
    images: [...new Set(images.filter(likelyImage))].slice(0, 12),
    ingredients,
    application,
    price: offers.price,
    currency: offers.currency,
    rawJsonLd: product,
  };
}
