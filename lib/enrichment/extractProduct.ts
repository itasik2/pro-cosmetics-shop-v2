import * as cheerio from "cheerio";
import { photoSku } from "./variantImages";
import { isProductPhoto } from "./photoQuality";
import { namedPhotoProductIssue, type NamePhotoProduct } from "./photoIdentity";

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
  const normalized = text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  for (const key of [
    "@graph",
    "hasVariant",
    "itemOffered",
    "mainEntity",
    "offers",
  ]) {
    if (object[key]) collectJsonLdNodes(object[key], output);
  }
}

function parseJsonLdScripts($: cheerio.CheerioAPI) {
  const nodes: Record<string, unknown>[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element)
      .text()
      .replace(/^\uFEFF/, "")
      .trim();
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
      : cleanText(toObject(value)?.url) ||
        cleanText(toObject(value)?.contentUrl);

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
    const directText = $(element).clone().children().remove().end().text();
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

  return !/(?:войдите|создайте уч[её]тную запись|создать уч[её]тную запись|личный кабинет|авторизац|регистрац|забыли пароль|forgot password|sign in|log in|login|account)/i.test(
    normalized,
  );
}

function productHeading($: cheerio.CheerioAPI) {
  const candidates = new Map<string, { text: string; score: number }>();

  $("h1, .product-title, .product-info h1, #content h1, main h1").each(
    (_, element) => {
      const text = cleanText($(element).text(), 500);
      if (!isLikelyProductTitle(text)) return;

      let score = Math.min(text.length, 120) / 120;
      if (
        $(element).closest("#content, main, .product-info, .product-page")
          .length
      )
        score += 20;
      if (/\d+\s*(?:мл|ml|г|гр|g|шт)\b/iu.test(text)) score += 10;
      if (/[А-ЯA-Z]{3,}/u.test(text)) score += 2;

      const previous = candidates.get(text);
      if (!previous || previous.score < score)
        candidates.set(text, { text, score });
    },
  );

  return (
    [...candidates.values()].sort((a, b) => b.score - a.score)[0]?.text ?? null
  );
}

function firstLikelyTitle(values: Array<string | null>) {
  return values.find(isLikelyProductTitle) ?? null;
}

function richestText(values: Array<string | null>) {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.length - left.length)[0] ?? null
  );
}

function isLikelyProductImage(value: string) {
  return Boolean(value) && isProductPhoto(value);
}

export function extractImagesForSku(input: {
  buffer: Buffer;
  finalUrl: string;
  sku: string;
  brand?: string | null;
  selectors?: SourceSelectors | null;
}) {
  const wanted = photoSku(input.sku);
  if (!wanted) return [];
  const $ = cheerio.loadBuffer(input.buffer, {
    encoding: { defaultEncoding: "utf-8" },
  });
  const nodes = parseJsonLdScripts($);
  const products = nodes.filter((node) => typeIncludesProduct(node["@type"]));
  const images: string[] = [];
  for (const product of products) {
    const expectedBrand = normalizeSearchText(input.brand || "");
    const brand = normalizeSearchText(readBrand(product.brand) || "");
    if (
      expectedBrand &&
      brand &&
      !brand.includes(expectedBrand) &&
      !expectedBrand.includes(brand) &&
      !normalizeSearchText(String(product.name || "")).includes(expectedBrand)
    )
      continue;
    if (photoSku(product.sku || product.mpn || product.productID) === wanted) {
      collectImageValues(product.image, input.finalUrl, images);
    }
    const offers = Array.isArray(product.offers)
      ? product.offers
      : [product.offers];
    for (const raw of offers) {
      const offer = toObject(raw);
      if (offer && photoSku(offer.sku) === wanted) {
        // An offer SKU never makes the parent product's picture variant-specific.
        collectImageValues(offer.image, input.finalUrl, images);
      }
    }
  }
  $("[itemscope][itemtype$='/Product'], [data-product-sku], [data-sku]").each(
    (_, element) => {
      const scope = $(element);
      const sku =
        scope.attr("data-product-sku") ||
        scope.attr("data-sku") ||
        scope.find("[itemprop='sku']").first().attr("content") ||
        scope.find("[itemprop='sku']").first().text();
      if (photoSku(sku) !== wanted) return;
      scope.find("[itemprop='image'], img").each((_, img) => {
        if (
          $(img)
            .closest(
              "[itemscope][itemtype$='/Product'], [data-product-sku], [data-sku]",
            )
            .get(0) !== element
        )
          return;
        const raw =
          $(img).attr("content") ||
          $(img).attr("src") ||
          $(img).attr("data-src");
        const url = asUrl(raw, input.finalUrl);
        if (url) images.push(url);
      });
    },
  );
  const oneSkuPage =
    products.length === 0 ||
    (products.length === 1 &&
      photoSku(products[0].sku || products[0].mpn || products[0].productID) ===
        wanted &&
      !products[0].hasVariant &&
      !(
        Array.isArray(products[0].offers)
          ? products[0].offers
          : [products[0].offers]
      ).some((raw) => {
        const offer = toObject(raw);
        return offer?.sku && photoSku(offer.sku) !== wanted;
      }));
  if (!images.length && oneSkuPage) {
    const extracted = extractProductFromHtml({
      ...input,
      expectedSku: input.sku,
    });
    if (photoSku(extracted.sku) === wanted) images.push(...extracted.images);
  }
  return [...new Set(images.filter(isLikelyProductImage))].slice(0, 12);
}

export function extractImagesForNamedProduct(input: {
  buffer: Buffer;
  finalUrl: string;
  product: NamePhotoProduct;
  confirmedBrand?: string;
  issues?: Set<string>;
}) {
  const $ = cheerio.loadBuffer(input.buffer, {
    encoding: { defaultEncoding: "utf-8" },
  });
  const products = parseJsonLdScripts($).filter((node) =>
    typeIncludesProduct(node["@type"]),
  );
  const extracted = extractProductFromHtml(input);
  const images: string[] = [];
  for (const node of products) {
    const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
    if (
      node.hasVariant ||
      offers.length > 1 ||
      offers.some((offer) => Number(toObject(offer)?.offerCount) > 1)
    ) {
      input.issues?.add("photo_volume_ambiguous");
      continue;
    }
    const source = {
      title: cleanText(node.name),
      brand:
        readBrand(node.brand) ||
        (products.length === 1 ? extracted.brand : null),
      description:
        cleanText(node.description) ||
        (products.length === 1 ? extracted.description : null),
      retailer: metaContent($, "meta[property='og:site_name']"),
      confirmedBrand: products.length === 1 ? input.confirmedBrand : undefined,
    };
    const issue = namedPhotoProductIssue(input.product, source);
    if (issue) {
      input.issues?.add(issue);
      continue;
    }
    collectImageValues(node.image, input.finalUrl, images);
    // Only the single matching product may supply its unscoped main gallery.
    if (products.length === 1) images.push(...extracted.images);
  }
  if (!products.length) {
    const issue = namedPhotoProductIssue(input.product, {
      ...extracted,
      retailer: metaContent($, "meta[property='og:site_name']"),
      confirmedBrand: input.confirmedBrand,
    });
    if (issue) input.issues?.add(issue);
    else images.push(...extracted.images);
  }
  const accepted = [...new Set(images.filter(isLikelyProductImage))].slice(
    0,
    12,
  );
  if (!accepted.length && !input.issues?.size)
    input.issues?.add("photo_images_missing");
  return accepted;
}

export function extractProductFromHtml(input: {
  buffer: Buffer;
  finalUrl: string;
  selectors?: SourceSelectors | null;
  expectedSku?: string | null;
}): ExtractedProductData {
  const $ = cheerio.loadBuffer(input.buffer, {
    encoding: { defaultEncoding: "utf-8" },
  });
  const nodes = parseJsonLdScripts($);
  const products = nodes.filter((node) => typeIncludesProduct(node["@type"]));
  const productNode =
    (input.expectedSku
      ? products.find(
          (node) =>
            photoSku(node.sku || node.mpn || node.productID) ===
            photoSku(input.expectedSku),
        )
      : null) ||
    products[0] ||
    null;
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
  const selectorSkinType = selectorText($, input.selectors?.skinType, 2_000);
  const selectorBenefits = selectorText($, input.selectors?.benefits, 4_000);

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
    input.expectedSku &&
    photoSku(productNode?.sku || productNode?.mpn || productNode?.productID) ===
      photoSku(input.expectedSku)
      ? cleanText(productNode?.name, 500)
      : null,
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
        ".product-info .product-image img, .product-image img, .product-gallery img, .product-gallery a, .product-photos img, .product-zoom-image img, a.cloud-zoom, a.cloud-zoom-gallery, .thumbnails img, a.thumbnail, [itemprop='image']",
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
    (/\bANGIOPHARM\b/i.test(`${title || ""} ${bodyText}`)
      ? "ANGIOPHARM"
      : null);

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
