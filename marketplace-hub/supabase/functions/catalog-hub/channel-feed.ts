import { digest } from "./core-domain.ts";
import { RequestError } from "./request-context.ts";
export type FeedOffer = { sellerSku: string; title: string; brand: string; price: number;
  availabilities: Array<{ storeId: string; stockCount: number; preorderDays?: number }> };
export function validateManifest(expected: unknown, actual: string[]) {
  if (!Array.isArray(expected) || !expected.length || expected.length > 100_000 || expected.some(x => typeof x !== "string" || !x)) {
    throw new RequestError("expected_seller_skus_required", 409);
  }
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length) throw new RequestError("duplicate_seller_sku", 409);
  const set = new Set(actual), required = new Set(expected);
  if (set.size !== required.size || expected.some(sku => !set.has(sku))) throw new RequestError("incomplete_feed_manifest", 409);
}
const escape = (s: string) => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);
export async function kaspiFeed(company: string, merchantId: string, offers: FeedOffer[], expectedSkus: unknown, date = new Date().toISOString()) {
  if (!company.trim() || !merchantId.trim()) throw new RequestError("merchant_identity_required", 409);
  validateManifest(expectedSkus, offers.map(offer => offer.sellerSku));
  const sorted = [...offers].sort((a,b) => a.sellerSku.localeCompare(b.sellerSku));
  for (const offer of sorted) {
    if (!/^[A-Za-z0-9]{1,20}$/.test(offer.sellerSku) || !offer.title.trim() || !offer.brand.trim() ||
      !Number.isSafeInteger(offer.price) || offer.price < 1 || !offer.availabilities.length) throw new RequestError("invalid_feed_offer", 409);
    const stores = new Set<string>();
    for (const stock of offer.availabilities) {
      if (!stock.storeId.trim() || stores.has(stock.storeId) || !Number.isSafeInteger(stock.stockCount) || stock.stockCount < 0 ||
          stock.preorderDays !== undefined && (!Number.isSafeInteger(stock.preorderDays) || stock.preorderDays < 1 || stock.preorderDays > 30)) {
        throw new RequestError("invalid_feed_warehouse", 409);
      }
      stores.add(stock.storeId);
    }
  }
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', `<kaspi_catalog date="${escape(date)}" xmlns="kaspiShopping" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="kaspiShopping http://kaspi.kz/kaspishopping.xsd">`,
    `<company>${escape(company)}</company>`, `<merchantid>${escape(merchantId)}</merchantid>`, '<offers>'];
  for (const offer of sorted) {
    lines.push(`<offer sku="${escape(offer.sellerSku)}"><model>${escape(offer.title)}</model><brand>${escape(offer.brand)}</brand><availabilities>`);
    for (const stock of offer.availabilities) lines.push(`<availability available="${stock.stockCount > 0 || stock.preorderDays ? "yes" : "no"}" storeId="${escape(stock.storeId)}" stockCount="${stock.stockCount}"${stock.preorderDays ? ` preOrder="${stock.preorderDays}"` : ""}/>`);
    lines.push(`</availabilities><price>${offer.price}</price></offer>`);
  }
  lines.push('</offers></kaspi_catalog>');
  return { xml: lines.join("\n") + "\n", checksum: await digest({ company, merchantId, offers: sorted }), count: sorted.length,
    sellerSkus: sorted.map(o => o.sellerSku), deliveryStatus: "NOT_PUBLISHED" };
}
