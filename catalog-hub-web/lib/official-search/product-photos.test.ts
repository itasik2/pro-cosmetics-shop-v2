import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { extractImagesForProduct, extractProductFromHtml } from "./extractProduct";
import { scoreProductMatch } from "./matchProduct";
import { searchSharedCatalogProduct } from "./sharedCatalogSearch";

const finalUrl = "https://brand.example/mask";
const product = { sku: "MASK-30", title: "Brand Hydrating Mask 30 g", brand: "Brand", volumeValue: 30, volumeUnit: "g" };
const node = (sku: string, amount: number, image: string[]) => ({ "@type": "Product", sku,
  name: "Brand Hydrating Mask " + amount + " g", brand: { name: "Brand" },
  description: "Hydrating mask. Also available as 30 g.", image });
const page = (nodes: unknown[]) => Buffer.from('<html><head><script type="application/ld+json">' +
  JSON.stringify({ "@graph": nodes }) + '</script></head><body><h1>Brand Hydrating Mask</h1></body></html>');

test("photo candidates belong to the exact nested SKU, never a sibling or parent gallery", () => {
  const buffer = page([{ "@type": "ProductGroup", image: "/generic.png",
    hasVariant: [node("MASK-210", 210, ["/210.png"]), node(product.sku, 30, ["/30.png"])] }]);
  assert.equal(extractProductFromHtml({ buffer, finalUrl, expectedSku: product.sku }).sku, product.sku);
  assert.deepEqual(extractImagesForProduct({ buffer, finalUrl, product }), ["https://brand.example/30.png"]);
  const offerOnly = page([{ ...node("PARENT", 30, ["/generic.png"]),
    offers: [{ "@type": "Offer", sku: product.sku }] }]);
  assert.deepEqual(extractImagesForProduct({ buffer: offerOnly, finalUrl, product }), []);
  const internal = { ...product, sku: "INT-PRICE-123456789ABC", skuIsInternal: true };
  const named = extractProductFromHtml({ buffer: page([node("MFR-210", 210, ["/210.png"]), node("MFR-30", 30, ["/30.png"])]),
    finalUrl, expectedProduct: internal });
  assert.equal(named.sku, "MFR-30");
});

test("source title size takes precedence over sizes in a common description", () => {
  const extracted = extractProductFromHtml({ buffer: page([node(product.sku, 210, ["/210.png"])]), finalUrl });
  const target = { name: product.title, supplierSku: product.sku, barcode: null,
    brand: { name: product.brand }, supplier: null, volumeValue: 30, volumeUnit: "g" };
  assert.equal(scoreProductMatch(target, extracted).evidence.volume, "mismatch");
  assert.equal(scoreProductMatch({ ...target, supplierSku: "AV-02" }, { ...extracted, sku: "AV02" }).evidence.sku, "mismatch");
  assert.equal(scoreProductMatch({ ...target, supplierSku: null, barcode: "1234567890123" }, extracted).evidence.sku, "missing");
});

test("shared preview returns decoded product photos sorted by resolution and excludes HTML", async () => {
  const large = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#bbccdd" } }).png().toBuffer();
  const small = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#ddbbcc" } }).png().toBuffer();
  const buffer = page([node("MASK-210", 210, ["/210.png"]), node(product.sku, 30, ["/small.png", "/html.png", "/large.png", "/copy.png"])]);
  const requested: string[] = [];
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await searchSharedCatalogProduct({ product, sourceUrl: finalUrl }, {
      fetchHtml: async () => ({ buffer, finalUrl, contentType: "text/html", status: 200, headers: {} }),
      fetchImage: async url => {
        requested.push(url);
        return { buffer: url.endsWith("/html.png") ? Buffer.from("<html>Gone</html>") : url.endsWith("/small.png") ? small : large,
          finalUrl: url, contentType: "image/png", status: 200, headers: {} };
      },
    });
    assert.deepEqual(result.images, ["https://brand.example/large.png", "https://brand.example/small.png"]);
    assert.ok(!requested.some(url => url.endsWith("/210.png")));
    assert.ok(result.warnings.includes("photo_files_rejected"));
    assert.equal(result.imageCandidates[0].sha256.length, 64);
  } finally {
    if (key !== undefined) process.env.OPENAI_API_KEY = key;
  }
});

test("OpenCart account headings do not mask the exact product gallery", () => {
  const buffer = Buffer.from('<div class="ajax-body-login"><h1>Login</h1><h1>Register</h1></div><div id="content"><h1>Brand Hydrating Mask 30 g</h1><ul class="list-unstyled"><li>Артикул: MASK-30</li></ul><div class="product-zoom-image"><img src="/30.png"></div><div id="product"></div></div>');
  assert.deepEqual(extractImagesForProduct({ buffer, finalUrl, product }), ["https://brand.example/30.png"]);
});

test("shared Tilda search resolves the exact edition before decoding its photo", async () => {
  const sourceUrl = "https://skinosophy.kz/products/demo-mask";
  const buffer = Buffer.from('<div id="allrecords" data-tilda-root-zone="pro"><div class="js-store-product_single" data-product-gen-uid="123456789012"></div><h1>Demo mask</h1></div>');
  const photo = await sharp({ create: { width: 640, height: 640, channels: 3, background: "#ddccbb" } }).png().toBuffer();
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const found = await searchSharedCatalogProduct({ sourceUrl, product: { sku: "DEMO-30", title: "Demo mask", brand: "Skinosophy", volumeValue: 30, volumeUnit: "g" } }, {
      fetchHtml: async () => ({ buffer, finalUrl: sourceUrl, status: 200, contentType: "text/html", headers: {} }),
      fetchCatalogJson: async () => ({ products: [{ uid: "123456789012", url: sourceUrl, title: "Demo mask",
        json_options: [{ title: "Package" }], editions: [
          { sku: "DEMO-210", Package: "Jar 210 g", img: "https://static.tildacdn.pro/210.png" },
          { sku: "DEMO-30", Package: "Sachet 30 g", img: "https://static.tildacdn.pro/30.png" },
        ] }] }),
      fetchImage: async url => {
        assert.equal(url, "https://static.tildacdn.pro/30.png");
        return { buffer: photo, finalUrl: url, status: 200, contentType: "image/png", headers: {} };
      },
    });
    assert.deepEqual(found.images, ["https://static.tildacdn.pro/30.png"]);
  } finally { if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey; }
});
