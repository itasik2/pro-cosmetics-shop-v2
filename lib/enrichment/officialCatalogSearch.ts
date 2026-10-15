import * as cheerio from "cheerio";

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
