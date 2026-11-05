import { photoSku, productPhotoIssue, photoHasVariants, type PhotoProduct } from "./photo-identity.js";
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
  for (const field of ["@graph", "hasVariant", "itemOffered", "mainEntity", "offers"]) {
    if (object[field]) collectNodes(object[field], output);
  }
}

function typeIncludesProduct(value: unknown) {
  return (Array.isArray(value) ? value : [value]).some(type => String(type).toLowerCase() === "product");
}

function parseJsonLdScripts($: cheerio.CheerioAPI) {
  const nodes: Record<string, unknown>[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try { collectNodes(JSON.parse($(element).text().replace(/^\uFEFF/, "").trim()), nodes); }
    catch { /* An invalid block does not hide other structured products. */ }
  });
  return nodes;
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
  let normalized = value.toLowerCase();
  try { normalized = new URL(value).pathname.split("/").pop()?.toLowerCase() || ""; }
  catch { return false; }
  if (/\.(?:svg|gif)(?:$|[?#])/.test(normalized)) return false;
  return !/(?:^|[^a-z0-9])(?:logo|icon|sprite|loader|spinner|banner|avatar|payment|social|captcha|placeholder|no[-_]?image)(?:$|[^a-z0-9])/i.test(
    normalized,
  );
}

export function extractProductFromHtml(input: {
  buffer: Buffer;
  finalUrl: string;
  expectedSku?: string | null;
  expectedProduct?: PhotoProduct;
}): ExtractedProductData {
  const $ = cheerio.loadBuffer(input.buffer, { encoding: { defaultEncoding: "utf-8" } });
  const products = parseJsonLdScripts($).filter(node => typeIncludesProduct(node["@type"]));
  const product = (input.expectedSku
    ? products.find(node => photoSku(node.sku || node.mpn || node.productID) === photoSku(input.expectedSku))
    : null) || (input.expectedProduct ? products.find(node => !productPhotoIssue(input.expectedProduct!, {
      sku: cleanText(node.sku || node.mpn || node.productID), title: cleanText(node.name),
      brand: readBrand(node.brand), description: cleanText(node.description), hasVariants: photoHasVariants(node),
    })) : null) || products[0] || null;
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

  $(".product-image img, .product-gallery img, .product-photos img, [itemprop='image']").each((_, element) => {
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

export function extractImagesForProduct(input: {
  buffer: Buffer;
  finalUrl: string;
  product: PhotoProduct;
  issues?: Set<string>;
}) {
  const $ = cheerio.loadBuffer(input.buffer, { encoding: { defaultEncoding: "utf-8" } });
  const nodes = parseJsonLdScripts($);
  const products = nodes.filter(node => typeIncludesProduct(node["@type"]));
  const images: string[] = [];
  const accept = (source: Parameters<typeof productPhotoIssue>[1], value: unknown) => {
    const issue = productPhotoIssue(input.product, source);
    if (issue) input.issues?.add(issue);
    else collectImages(value, input.finalUrl, images);
    return !issue;
  };
  for (const node of products) {
    const source = {
      sku: cleanText(node.sku || node.mpn || node.productID),
      title: cleanText(node.name),
      brand: readBrand(node.brand),
      description: cleanText(node.description),
      hasVariants: photoHasVariants(node),
    };
    if (accept(source, node.image) && !images.length && products.length === 1 && !source.hasVariants) {
      const extracted = extractProductFromHtml({ ...input, expectedSku: source.sku });
      images.push(...extracted.images);
    }
    const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
    for (const value of offers) {
      const offer = toObject(value);
      if (!offer?.sku || !offer.image) continue;
      accept({
        ...source, sku: cleanText(offer.sku), title: cleanText(offer.name) || source.title,
        hasVariants: Number(offer.offerCount) > 1,
      }, offer.image);
    }
  }
  const scopes = $("[itemscope][itemtype$='/Product'], [data-product-sku], [data-sku]");
  scopes.each((_, element) => {
    const scope = $(element);
    const own = (selector: string) => scope.find(selector).filter((_, child) =>
      $(child).closest("[itemscope][itemtype$='/Product'], [data-product-sku], [data-sku]").get(0) === element);
    const field = (name: string) => {
      const found = own("[itemprop='" + name + "']").first();
      return found.attr("content") || found.text() || null;
    };
    const brandNode = own("[itemprop='brand']").first();
    const source = {
      sku: scope.attr("data-product-sku") || scope.attr("data-sku") || field("sku"),
      title: field("name"), description: field("description"),
      brand: brandNode.find("[itemprop='name']").attr("content") || field("brand"),
      hasVariants: scope.find("[itemprop='hasVariant']").length > 0,
    };
    if (productPhotoIssue(input.product, source)) return;
    own("[itemprop='image'], img").each((_, image) => {
      const item = $(image);
      collectImages(item.attr("content") || item.attr("data-src") || item.attr("src"), input.finalUrl, images);
    });
  });
  if (!products.length && !scopes.length && $("h1").length === 1) {
    const extracted = extractProductFromHtml(input);
    accept({ ...extracted, sku: null }, extracted.images);
  }
  return [...new Set(images.filter(likelyImage))].slice(0, 8);
}
