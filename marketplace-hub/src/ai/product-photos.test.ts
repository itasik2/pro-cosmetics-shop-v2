import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { extractImagesForProduct, extractProductFromHtml } from "./extract.js";
import { scoreProductMatch } from "./match.js";
import { photoSku, productVolumes, productPhotoIssue } from "./photo-identity.js";
import { buildEnrichmentProposal } from "./enrich.js";
import { verifyProductImages } from "./verified-photos.js";
import { decodeProductPhoto } from "../media/image.js";
import { safeFetchExternal, pinnedSourceLookup } from "./network.js";

const finalUrl = "https://brand.example/mask";
const product = { sku: "MASK-30", title: "Brand Hydrating Mask 30 g", brand: "Brand", volumeValue: 30, volumeUnit: "g" };
const page = (nodes: unknown[]) => Buffer.from('<html><head><script type="application/ld+json">' +
  JSON.stringify({ "@graph": nodes }) + '</script></head><body><h1>Brand Hydrating Mask</h1></body></html>');
const node = (sku: string, amount: number, images: string[]) => ({
  "@type": "Product", sku, name: "Brand Hydrating Mask " + amount + " g",
  brand: { name: "Brand" }, description: "Hydrating mask. Also available as 30 g and 210 g.",
  image: images,
});

test("selects a nested exact SKU and excludes the first related product and shared gallery", () => {
  const buffer = page([node("OTHER", 210, ["/other.png"]), {
    "@type": "ProductGroup", image: "/generic.png",
    hasVariant: [node("MASK-210", 210, ["/210.png"]), node(product.sku, 30, ["/30.png"])],
  }]);
  const extracted = extractProductFromHtml({ buffer, finalUrl, expectedSku: product.sku });
  assert.equal(extracted.sku, product.sku);
  assert.deepEqual(extractImagesForProduct({ buffer, finalUrl, product }), ["https://brand.example/30.png"]);
  assert.deepEqual(extractImagesForProduct({ buffer: page([node(product.sku, 30, ["/icons/30.png", "/icons/logo.png"])]),
    finalUrl, product }), ["https://brand.example/icons/30.png"]);
});

test("SKU punctuation and fractional or converted volumes remain significant", () => {
  assert.notEqual(photoSku("AV-02"), photoSku("AV02"));
  assert.equal(productPhotoIssue({ ...product, sku: "AV-02" }, { ...product, sku: "AV02" }), "photo_sku_mismatch");
  assert.equal(productPhotoIssue(product, { sku: product.sku, title: "Unknown mask 30 g" }), "photo_brand_unconfirmed");
  assert.equal(productPhotoIssue(product, { sku: product.sku, title: product.title }), null);
  assert.equal(productPhotoIssue({ ...product, skuIsInternal: true, volumeValue: undefined, volumeUnit: undefined },
    { sku: "MFR-210", title: "Brand Hydrating Mask 210 g", brand: "Brand" }), "photo_volume_mismatch");
  assert.equal(productPhotoIssue({ ...product, skuIsInternal: true, title: "Brand Hydrating Mask", volumeValue: undefined, volumeUnit: undefined },
    { sku: "MFR-210", title: "Brand Hydrating Mask 210 g", brand: "Brand" }), "photo_volume_unconfirmed");
  assert.deepEqual(productVolumes("0,5 г / 0.03 kg / 30 г / 30/210 g"), ["0.5:g", "30:g", "210:g"]);
  const wrong = extractProductFromHtml({ buffer: page([node(product.sku, 210, ["/210.png"])]), finalUrl });
  assert.equal(scoreProductMatch(product, wrong).evidence.volume, "mismatch");
  assert.deepEqual(extractImagesForProduct({ buffer: page([node(product.sku, 210, ["/210.png"])]), finalUrl, product }), []);
});

test("internal SKUs require an exact named single product with confirmed brand and size", () => {
  const internal = { ...product, sku: "INT-PRICE-123456789ABC", skuIsInternal: true };
  assert.deepEqual(extractImagesForProduct({ buffer: page([node("MFR-30", 30, ["/30.png"])]), finalUrl, product: internal }), ["https://brand.example/30.png"]);
  const grouped = { ...node("MFR-30", 30, ["/generic.png"]), hasVariant: [node("MFR-210", 210, ["/210.png"])] };
  assert.deepEqual(extractImagesForProduct({ buffer: page([grouped]), finalUrl, product: internal }), []);
  const matching = extractProductFromHtml({ buffer: page([node("MFR-210", 210, ["/210.png"]), node("MFR-30", 30, ["/30.png"])]),
    finalUrl, expectedProduct: internal });
  assert.equal(matching.sku, "MFR-30");
});

test("normal enrichment verifies files, removes duplicate bytes and selects the largest photo", async () => {
  const large = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#d8bfa7" } }).png().toBuffer();
  const small = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#ccbbdd" } }).png().toBuffer();
  const buffer = page([node("MASK-210", 210, ["/210.png"]),
    node(product.sku, 30, ["/small.png", "/html.png", "/large.png", "/same.png"])]);
  const requested: string[] = [];
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const proposal = await buildEnrichmentProposal({ product, sourceUrl: finalUrl, discoverIfMissing: false }, {
      fetchHtml: async () => ({ buffer, finalUrl, contentType: "text/html", status: 200, headers: {} }),
      fetchImage: async url => {
        requested.push(url);
        return { buffer: url.endsWith("html.png") ? Buffer.from("<html>Expired</html>") : url.endsWith("small.png") ? small : large,
          finalUrl: url, contentType: "image/png", status: 200, headers: {} };
      },
    });
    assert.ok(requested.every(url => !url.endsWith("/210.png")));
    assert.deepEqual(proposal.imageCandidates.map(item => item.url), ["https://brand.example/large.png", "https://brand.example/small.png"]);
    assert.equal(proposal.imageCandidates[0].width, 1200);
    assert.equal(proposal.imageCandidates[0].sha256.length, 64);
    assert.ok(proposal.warnings.includes("photo_files_rejected"));
    const avif = await sharp({ create: { width: 240, height: 240, channels: 3, background: "#ccbbaa" } }).avif({ effort: 0 }).toBuffer();
    const avifResult = await verifyProductImages(["https://brand.example/product.avif"],
      async url => ({ buffer: avif, contentType: "image/avif", finalUrl: url }), decodeProductPhoto);
    assert.equal(avifResult.images.length, 1, "AV1 inside a HEIF container is accepted as AVIF");
  } finally {
    if (key !== undefined) process.env.OPENAI_API_KEY = key;
  }
});

test("source requests pin the validated address and reject private DNS or off-domain redirects", async () => {
  const pinned = { address: "93.184.216.34", family: 4 };
  const lookup = pinnedSourceLookup(pinned);
  assert.deepEqual(await new Promise(resolve => lookup("brand.example", { all: true }, (_error, addresses) => resolve(addresses))), [pinned]);
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }); }) as typeof fetch;
  const options = { policies: [{ domain: "brand.example", allowSubdomains: false }], maxBytes: 1024, acceptedContentTypes: ["image/png"] };
  await assert.rejects(safeFetchExternal(finalUrl, options, { fetcher, resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }] }), /source_dns_blocked/);
  assert.equal(calls, 0);
  await assert.rejects(safeFetchExternal(finalUrl, options, { fetcher, resolveHostname: async () => [pinned] }), /source_domain_not_allowed/);
});
