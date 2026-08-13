import * as cheerio from "cheerio";

export type SourceSelectors = {
  title?: string;
  description?: string;
  skinType?: string;
  benefits?: string;
  ingredients?: string;
  application?: string;
  images?: string;
};

export type ExtractedProductData = {
  title: string | null;
  description: string | null;
  skinType: string | null;
  benefits: string | null;
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

    if (Number.isFinite(price) && price > 0) {
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
        $(element).attr("data-large-img-url") ||
        $(element).attr("href");
      const elementHint = [
        raw,
        $(element).attr("alt"),
        $(element).attr("title"),
        $(element).attr("class"),
        $(element).attr("id"),
        $(element).attr("aria-label"),
      ]
        .filter(Boolean)
        .join(" ");
      if (!isLikelyProductImage(elementHint)) return;
      const url = asUrl(raw, baseUrl);
      if (url && isLikelyProductImage(url)) images.push(url);
    });
  } catch {
    return [];
  }

  return images;
}

function metaContent($: cheerio.CheerioAPI, selector: string) {
  return cleanText($(selector).first().attr("content"));
}

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function labeledSection(input: {
  text: string;
  starts: string[];
  ends: string[];
  maxLength: number;
}) {
  const search = normalizeSearchText(input.text);
  let startIndex = -1;
  let startLength = 0;

  for (const label of input.starts) {
    const normalizedLabel = normalizeSearchText(label);
    const index = search.indexOf(normalizedLabel);
    if (index >= 0 && (startIndex < 0 || index < startIndex)) {
      startIndex = index;
      startLength = normalizedLabel.length;
    }
  }

  if (startIndex < 0) return null;

  const contentStart = startIndex + startLength;
  let contentEnd = input.text.length;
  for (const label of input.ends) {
    const index = search.indexOf(normalizeSearchText(label), contentStart);
    if (index >= contentStart && index < contentEnd) contentEnd = index;
  }

  return cleanText(input.text.slice(contentStart, contentEnd), input.maxLength);
}

function skuFromText(text: string) {
  const match = text.match(
    /(?:артикул|sku|код\s+товара)\s*:?\s*([A-ZА-Я0-9][A-ZА-Я0-9._/-]{1,39})/iu,
  );
  return cleanText(match?.[1], 100);
}

function localizedPriceFromText(text: string) {
  const match = text.match(
    /(\d[\d\s]{0,12}(?:[.,]\d{1,2})?)\s*(?:₸|тг\.?|kzt)/iu,
  );
  if (!match) return null;

  const normalized = match[1].replace(/\s+/g, "").replace(",", ".");
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function likelyIngredientList($: cheerio.CheerioAPI) {
  const candidates: Array<{ text: string; score: number }> = [];

  $("p, div, td, li").each((_, element) => {
    const directText = $(element)
      .clone()
      .children()
      .remove()
      .end()
      .text();
    const text = cleanText(directText, 8_000);
    if (!text || text.length < 50) return;

    const commaCount = (text.match(/,/g) || []).length;
    const latinCount = (text.match(/[A-Za-z]/g) || []).length;
    const letterCount = (text.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
    const latinRatio = letterCount ? latinCount / letterCount : 0;

    if (commaCount < 4 || latinRatio < 0.55) return;
    const score =
      commaCount * 10 + latinRatio * 100 + Math.min(text.length, 500) / 10;
    candidates.push({ text, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.text ?? null;
}

function isLikelyProductTitle(value: string | null): value is string {
  if (!value || value.length < 4) return false;
  const normalized = normalizeSearchText(value);

  return !/(?:войдите|создайте учетную запись|создать учетную запись|личный кабинет|авторизац|регистрац|забыли пароль|forgot password|sign in|log in|login|account)/i.test(
    normalized,
  );
}

function productHeading($: cheerio.CheerioAPI) {
  const candidates = new Map<string, { text: string; score: number }>();

  $("h1, .product-title, .product-info h1, #content h1, main h1").each((_, element) => {
    const text = cleanText($(element).text(), 500);
    if (!isLikelyProductTitle(text)) return;

    let score = Math.min(text.length, 120) / 120;
    if ($(element).closest("#content, main, .product-info, .product-page").length) score += 20;
    if (/\d+\s*(?:мл|ml|г|гр|g|шт)\b/iu.test(text)) score += 10;
    if (/[А-ЯA-Z]{3,}/u.test(text)) score += 2;

    const previous = candidates.get(text);
    if (!previous || previous.score < score) candidates.set(text, { text, score });
  });

  return [...candidates.values()].sort((a, b) => b.score - a.score)[0]?.text ?? null;
}

function firstLikelyTitle(values: Array<string | null>) {
  return values.find(isLikelyProductTitle) ?? null;
}

function richestText(values: Array<string | null>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length)[0] ?? null;
}

function isLikelyProductImage(value: string) {
  const normalized = value.toLocaleLowerCase("ru-RU");
  if (!normalized) return false;
  if (/\.(?:svg|gif)(?:$|[?#])/i.test(normalized)) return false;

  return !/(?:ajax[._-]?loader|loader|loading|spinner|progress|preload|logo|icon|sprite|payment|favicon|avatar|badge|banner|button|widget|social|share|instagram|whatsapp|facebook|telegram|yandex|passport|login|signin|sign-in|auth|oauth|captcha)/i.test(
    normalized,
  );
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
  const bodyText = cleanText($("body").text(), 200_000) || "";

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
  const selectorSkinType = selectorText(
    $,
    input.selectors?.skinType,
    2_000,
  );
  const selectorBenefits = selectorText(
    $,
    input.selectors?.benefits,
    4_000,
  );

  const fallbackApplication = labeledSection({
    text: bodyText,
    starts: ["СПОСОБ ПРИМЕНЕНИЯ:", "СПОСОБ ПРИМЕНЕНИЯ"],
    ends: [
      "ОПИСАНИЕ:",
      "ОПИСАНИЕ",
      "АКТИВНЫЕ КОМПОНЕНТЫ",
      "ХАРАКТЕРИСТИКИ",
      "СОСТАВ",
      "КОНТАКТЫ",
    ],
    maxLength: 8_000,
  });
  const fallbackDescription = labeledSection({
    text: bodyText,
    starts: ["ОПИСАНИЕ:", "ОПИСАНИЕ"],
    ends: [
      "ТИП КОЖИ",
      "ДЛЯ КАКОЙ КОЖИ",
      "ДЕЙСТВИЕ",
      "ЭФФЕКТ",
      "ПРЕИМУЩЕСТВА",
      "СПОСОБ ПРИМЕНЕНИЯ",
      "АКТИВНЫЕ КОМПОНЕНТЫ",
      "ХАРАКТЕРИСТИКИ",
      "СОСТАВ",
      "КОНТАКТЫ",
    ],
    maxLength: 12_000,
  });
  const fallbackSkinType = labeledSection({
    text: bodyText,
    starts: [
      "ТИП КОЖИ:",
      "ТИП КОЖИ",
      "ДЛЯ КАКОЙ КОЖИ:",
      "ДЛЯ КАКОЙ КОЖИ",
      "ПОДХОДИТ ДЛЯ:",
    ],
    ends: [
      "ОПИСАНИЕ",
      "ДЕЙСТВИЕ",
      "ЭФФЕКТ",
      "ПРЕИМУЩЕСТВА",
      "СПОСОБ ПРИМЕНЕНИЯ",
      "АКТИВНЫЕ КОМПОНЕНТЫ",
      "ХАРАКТЕРИСТИКИ",
      "СОСТАВ",
      "КОНТАКТЫ",
    ],
    maxLength: 2_000,
  });
  const fallbackBenefits = labeledSection({
    text: bodyText,
    starts: [
      "ДЕЙСТВИЕ:",
      "ДЕЙСТВИЕ",
      "ЭФФЕКТ:",
      "ЭФФЕКТ",
      "ПРЕИМУЩЕСТВА:",
      "ПРЕИМУЩЕСТВА",
      "РЕЗУЛЬТАТ:",
      "РЕЗУЛЬТАТ",
    ],
    ends: [
      "ОПИСАНИЕ",
      "ТИП КОЖИ",
      "ДЛЯ КАКОЙ КОЖИ",
      "СПОСОБ ПРИМЕНЕНИЯ",
      "АКТИВНЫЕ КОМПОНЕНТЫ",
      "ХАРАКТЕРИСТИКИ",
      "СОСТАВ",
      "КОНТАКТЫ",
    ],
    maxLength: 4_000,
  });

  const title = firstLikelyTitle([
    selectorTitle,
    cleanText(productNode?.name, 500),
    productHeading($),
    metaContent($, "meta[property='og:title']"),
    metaContent($, "meta[name='twitter:title']"),
    cleanText($("title").first().text(), 500),
  ]);

  const description =
    selectorDescription ||
    richestText([
      cleanText(productNode?.description),
      fallbackDescription,
      metaContent($, "meta[property='og:description']"),
      metaContent($, "meta[name='description']"),
      metaContent($, "meta[name='twitter:description']"),
    ]);

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
  if (images.length < 2) {
    images.push(
      ...selectorImages(
        $,
        "main img, #content img, .product-info img, .product-image img, .thumbnails img, a.thumbnail",
        input.finalUrl,
      ),
    );
  }

  const offers = readOffers(productNode?.offers);
  const fallbackPrice = localizedPriceFromText(bodyText);
  const fallbackCurrency =
    fallbackPrice !== null && /(?:₸|тг\.?|kzt)/iu.test(bodyText) ? "KZT" : null;
  const brand =
    readBrand(productNode?.brand) ||
    metaContent($, "meta[property='product:brand']") ||
    metaContent($, "meta[name='brand']") ||
    (/\bANGIOPHARM\b/i.test(`${title || ""} ${bodyText}`) ? "ANGIOPHARM" : null);

  return {
    title,
    description,
    skinType: selectorSkinType || fallbackSkinType,
    benefits: selectorBenefits || fallbackBenefits,
    sku:
      cleanText(productNode?.sku, 100) ||
      cleanText(productNode?.mpn, 100) ||
      cleanText(productNode?.productID, 100) ||
      skuFromText(bodyText),
    brand,
    canonicalUrl,
    images: [...new Set(images.filter(isLikelyProductImage))].slice(0, 12),
    ingredients:
      selectorIngredients ||
      cleanText(productNode?.ingredients, 8_000) ||
      likelyIngredientList($),
    application:
      selectorApplication ||
      cleanText(productNode?.usageInfo, 8_000) ||
      fallbackApplication,
    price: offers.price ?? fallbackPrice,
    currency: offers.currency || fallbackCurrency,
    rawJsonLd: productNode,
  };
}
