import * as cheerio from "cheerio";
import { safeFetchCatalogJson } from "./network";
import { remainingTime } from "./timeBudget";
import { photoNameParts } from "./photoIdentity";
import { photoSku } from "./variantImages";
import { isProductPhoto } from "./photoQuality";
import { productDisplayName } from "../productNames";
import type { MatchableProduct } from "./matchProduct";

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { /* No executable script parsing. */ }
  return [];
}
function document(buffer: Buffer) {
  return cheerio.loadBuffer(buffer, { encoding: { defaultEncoding: "utf-8" } });
}
function apiHost($: cheerio.CheerioAPI) {
  const zone = $("#allrecords").attr("data-tilda-root-zone") || "com";
  return ["com", "pro", "info"].includes(zone) ? "store.tildaapi." + zone : null;
}
function pageKey(raw: unknown, base: string) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.origin !== new URL(base).origin) return null;
    return url.origin + (url.pathname.replace(/\/$/, "") || "/");
  } catch { return null; }
}
function sameFamily(product: MatchableProduct, title: unknown) {
  if (typeof title !== "string" || !product.brand?.name) return false;
  const expected = photoNameParts(productDisplayName(product), product.brand.name);
  const actual = photoNameParts(title, product.brand.name);
  return expected.name.length >= 3 && expected.name === actual.name && expected.types.join(",") === actual.types.join(",");
}
function editions(product: JsonObject) { return array(product.editions).map(object).filter((row): row is JsonObject => Boolean(row)); }
function officialPage(url: string, domains: string[]) {
  const hostname = new URL(url).hostname.toLowerCase();
  return domains.some((domain) => hostname === domain.toLowerCase() || hostname.endsWith("." + domain.toLowerCase()));
}

export function tildaProductReference(buffer: Buffer) {
  const $ = document(buffer);
  const products = $(".js-store-product_single, .js-product-single");
  if (products.length !== 1) return null;
  const uid = products.first().attr("data-product-gen-uid")?.replace(/^product id:\s*/i, "");
  const host = apiHost($);
  return uid && /^\d{6,20}$/.test(uid) && host ? { uid, host } : null;
}

/** Read a selected edition's explicit photo. A shared gallery is never inherited. */
export async function tildaVariantPhoto(input: {
  buffer: Buffer; finalUrl: string; product: MatchableProduct; sku: string;
  officialDomains: string[]; deadlineAt: number;
}, readJson = safeFetchCatalogJson) {
  if (!officialPage(input.finalUrl, input.officialDomains)) return null;
  const ref = tildaProductReference(input.buffer);
  if (!ref) return null;
  const data = object(await readJson("https://" + ref.host + "/api/getproductsbyuid/", [
    { domain: ref.host, allowSubdomains: false },
  ], { sourceUrl: input.finalUrl, jsonBody: { productsuid: [ref.uid], c: Date.now() },
    timeoutMs: remainingTime(input.deadlineAt, 12_000) }));
  const products = array(data?.products).map(object).filter((row): row is JsonObject => Boolean(row) && String(row!.uid) === ref.uid);
  if (products.length !== 1) throw new Error("source_catalog_product_mismatch");
  const product = products[0];
  if (![product.url, product.buttonlink].some((url) => pageKey(url, input.finalUrl) === pageKey(input.finalUrl, input.finalUrl)) ||
    !sameFamily(input.product, product.title)) return null;
  const matching = editions(product).filter((row) => photoSku(row.sku) === photoSku(input.sku));
  if (matching.length !== 1) return null;
  const edition = matching[0];
  if (typeof edition.img !== "string" || !isProductPhoto(edition.img)) return null;
  let image: URL;
  try { image = new URL(edition.img); } catch { return null; }
  if (image.protocol !== "https:" || image.username || image.password || image.port ||
    !(image.hostname === new URL(input.finalUrl).hostname || /(?:^|\.)tildacdn\.(?:pro|com|info)$/.test(image.hostname))) return null;
  const options = array(product.json_options).map(object).flatMap((row) => typeof row?.title === "string" ? [row.title] : []);
  const label = options.map((title) => edition[title]).filter((value): value is string => typeof value === "string").join(" ").slice(0, 500);
  return { sku: String(edition.sku), label, image: image.toString(), title: String(product.title) + (label ? " " + label : "") };
}

/** Catalog entries supply links; the linked product and exact edition are checked separately. */
export async function tildaCatalogProductUrls(input: {
  buffer: Buffer; finalUrl: string; product: MatchableProduct; sku: string; deadlineAt: number;
}, readJson = safeFetchCatalogJson) {
  const $ = document(input.buffer);
  if ($(".js-store-product_single, .js-product-single").length) return [];
  const grids = $(".js-store-grid-cont");
  if (grids.length !== 1) return [];
  const recid = grids.first().closest(".t-rec").attr("id")?.replace(/^rec/, "");
  const host = apiHost($);
  if (!recid || !/^\d+$/.test(recid) || !host) return [];
  const scripts = $("script:not([src])").map((_, element) => $(element).text()).get()
    .filter((text) => new RegExp(`t_store_init\\s*\\(\\s*['"]${recid}['"]`).test(text));
  if (scripts.length !== 1) return [];
  const part = scripts[0].match(/\bstorepart\s*:\s*['"](\d{6,20})['"]/)?.[1];
  if (!part) return [];
  for (let slice = 1; slice <= 2; slice++) {
    const url = new URL("https://" + host + "/api/getproductslist/");
    Object.entries({ storepartuid: part, recid, size: "100", slice: String(slice), flag_root: "withroot", c: String(Date.now()) })
      .forEach(([key, value]) => url.searchParams.set(key, value));
    const data = object(await readJson(url.toString(), [{ domain: host, allowSubdomains: false }], {
      sourceUrl: input.finalUrl, timeoutMs: remainingTime(input.deadlineAt, 12_000),
    }));
    if (!data || !Array.isArray(data.products)) throw new Error("source_catalog_invalid_json");
    const products = data.products.map(object).filter((row): row is JsonObject => Boolean(row));
    const links = products.filter((row) => sameFamily(input.product, row.title) &&
      (photoSku(row.sku) === photoSku(input.sku) || editions(row).some((edition) => photoSku(edition.sku) === photoSku(input.sku))))
      .map((row) => pageKey(row.url || row.buttonlink, input.finalUrl)).filter((url): url is string => Boolean(url) && url !== pageKey(input.finalUrl, input.finalUrl));
    if (links.length) return [...new Set(links)].slice(0, 3);
    if (products.length < 100 || Number(data.total) <= slice * 100) break;
  }
  return [];
}
