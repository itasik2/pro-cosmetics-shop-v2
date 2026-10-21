import * as cheerio from "cheerio";
import { photoComparisonText, photoNameParts } from "./photoIdentity";

// These official stores use OpenCart. Query their catalog directly before
// asking the AI to discover a page; never construct a guessed image URL.
const OPENCART_DOMAINS = new Set(["angiopharm.com", "angiopharm.kz"]);

export function officialCatalogSearchUrls(domains: string[], sku: string) {
  const urls = domains.flatMap((domain) => {
    try {
      const origin = new URL("https://" + domain.replace(/^https?:\/\//, ""));
      if (!OPENCART_DOMAINS.has(origin.hostname.replace(/^www\./, "")))
        return [];
      const url = new URL("/index.php", origin);
      url.searchParams.set("route", "product/search");
      url.searchParams.set("search", sku.trim());
      return [url.toString()];
    } catch {
      return [];
    }
  });
  return [...new Set(urls)].slice(0, 2);
}

export function catalogProductUrls(buffer: Buffer, finalUrl: string) {
  const $ = cheerio.loadBuffer(buffer, {
    encoding: { defaultEncoding: "utf-8" },
  });
  const urls: string[] = [];
  // A search result only supplies links. Its thumbnails are never accepted as
  // SKU evidence: every linked product page must pass the usual identity check.
  $("#content .product-thumb, #content .product-layout").each((_, card) => {
    const href = $(card)
      .find("h4 a, h3 a, .product-name a, .image a")
      .first()
      .attr("href");
    if (!href) return;
    try {
      const url = new URL(href, finalUrl);
      if (url.origin !== new URL(finalUrl).origin) return;
      if (
        url.pathname === "/" ||
        (url.searchParams.has("route") &&
          url.searchParams.get("route") !== "product/product")
      )
        return;
      url.hash = "";
      urls.push(url.toString());
    } catch {
      // Ignore a malformed catalog entry.
    }
  });
  return [...new Set(urls)].slice(0, 3);
}

function compactBrand(value: string) {
  return photoComparisonText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

// A retailer may put its own name in Product.brand. Confirm membership in its
// brand collection before treating that metadata as a seller, not a maker.
export function namedBrandCatalogUrls(
  buffer: Buffer,
  finalUrl: string,
  brand: string,
  productName: string,
) {
  const $ = cheerio.loadBuffer(buffer, {
    encoding: { defaultEncoding: "utf-8" },
  });
  const expected = compactBrand(brand);
  if (!expected) return [];
  const types = photoNameParts(productName, brand).types;
  const candidates: { url: string; score: number }[] = [];
  $("a[href]").each((_, element) => {
    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (!compactBrand(text).includes(expected) || text.length > 100) return;
    try {
      const url = new URL($(element).attr("href")!, finalUrl);
      if (
        url.origin !== new URL(finalUrl).origin ||
        !/^\/collections\/[^/]+\/?$/.test(url.pathname)
      )
        return;
      url.search = "";
      url.hash = "";
      candidates.push({
        url: url.toString(),
        score:
          10 *
            types.filter(
              (type) =>
                text.toLowerCase().includes(type) ||
                url.pathname.includes(type),
            ).length +
          2 * Number(compactBrand(text) === expected),
      });
    } catch {
      /* Ignore malformed navigation links. */
    }
  });
  return [
    ...new Set(
      candidates.sort((a, b) => b.score - a.score).map((item) => item.url),
    ),
  ].slice(0, 2);
}

function productHandle(rawUrl: string, baseUrl: string) {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (url.origin !== new URL(baseUrl).origin) return null;
    return url.pathname.match(/\/(?:products)\/([^/]+)\/?$/)?.[1] || null;
  } catch {
    return null;
  }
}

export function catalogConfirmsProductBrand(
  buffer: Buffer,
  finalUrl: string,
  productUrl: string,
  brand: string,
) {
  try {
    if (new URL(finalUrl).origin !== new URL(productUrl).origin) return false;
  } catch {
    return false;
  }
  const $ = cheerio.loadBuffer(buffer, {
    encoding: { defaultEncoding: "utf-8" },
  });
  const main = $("main, #MainContent, [role='main']");
  const heading =
    main.find("h1").first().text() ||
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text();
  if (
    !compactBrand(heading).includes(compactBrand(brand)) ||
    !compactBrand(brand)
  )
    return false;
  const handle = productHandle(productUrl, finalUrl);
  if (!handle) return false;
  return main
    .find(
      ".product-grid-item a[href], .grid-product a[href], .product-grid a[href], [data-collection-grid] a[href]",
    )
    .toArray()
    .some(
      (element) =>
        !$(element).closest(
          "nav, header, footer, .cart-recommendations, .recommendations, .product-recommendations, product-recommendations, [data-product-recommendations]",
        ).length &&
        productHandle($(element).attr("href")!, finalUrl) === handle,
    );
}
