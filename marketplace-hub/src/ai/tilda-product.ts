import { photoSku, isInternalPhotoSku, productPhotoIssue, type PhotoProduct } from "./photo-identity.js";

export type TildaReference = { uid: string; host: string };
type Row = Record<string, unknown>;
function object(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}
function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}
function pageKey(raw: unknown, sourceUrl: string) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw, sourceUrl);
    if (url.origin !== new URL(sourceUrl).origin || url.username || url.password) return null;
    return url.origin + (url.pathname.replace(/\/$/, "") || "/");
  } catch { return null; }
}

// A Tilda page identifies its own product UID. The public catalog response must
// bind that UID back to the same page before an edition's photo can be offered.
export async function readTildaEdition(input: {
  reference: TildaReference; sourceUrl: string; product: PhotoProduct; brandConfirmed: boolean;
}, readJson: (url: string, body: { productsuid: string[] }) => Promise<unknown>) {
  const { reference, product, sourceUrl } = input;
  if (!/^\d{6,20}$/.test(reference.uid) || !/^store\.tildaapi\.(?:com|pro|info)$/.test(reference.host)) {
    throw new Error("source_catalog_reference_invalid");
  }
  const response = object(await readJson("https://" + reference.host + "/api/getproductsbyuid/", { productsuid: [reference.uid] }));
  const matches = array(response?.products).map(object).filter((row): row is Row =>
    Boolean(row) && String(row!.uid) === reference.uid);
  if (matches.length !== 1) throw new Error("source_catalog_product_mismatch");
  const parent = matches[0];
  if (![parent.url, parent.buttonlink].some(url => pageKey(url, sourceUrl) === pageKey(sourceUrl, sourceUrl))) {
    throw new Error("source_catalog_product_mismatch");
  }
  if (typeof parent.title !== "string" || parent.title.length > 500) throw new Error("source_catalog_product_mismatch");
  const brand = typeof parent.brand === "string" ? parent.brand : input.brandConfirmed ? product.brand : null;
  const optionNames = array(parent.json_options).map(object)
    .flatMap(option => typeof option?.title === "string" ? [option.title] : []);
  const editions = array(parent.editions).slice(0, 200).map(object).filter((row): row is Row => Boolean(row));
  const candidates = editions.flatMap(edition => {
    const sku = typeof edition.sku === "string" ? edition.sku : "";
    const label = optionNames.map(name => edition[name]).filter(value => typeof value === "string").join(" ").slice(0,500);
    const title = parent.title + (label ? " " + label : "");
    if (productPhotoIssue(product, { sku, title, brand })) return [];
    const image = typeof edition.img === "string" ? edition.img : "";
    let images: string[] = [];
    try {
      const url = new URL(image);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
        (url.hostname === new URL(sourceUrl).hostname || /(?:^|\.)tildacdn\.(?:com|pro|info)$/.test(url.hostname))) images = [url.href];
    } catch { /* An edition without its own photo keeps an empty candidate list. */ }
    return [{ sku, title, brand: brand || null, images, label }];
  });
  if (candidates.length !== 1) return null;
  const selected = candidates[0];
  if (!product.skuIsInternal && !isInternalPhotoSku(product.sku) && photoSku(selected.sku) !== photoSku(product.sku)) return null;
  return selected;
}
