import assert from "node:assert/strict";
import test from "node:test";
import { readTildaEdition } from "./tilda-product.js";
import { extractTildaReference, extractImagesForProduct } from "./extract.js";
import { safeFetchExternal } from "./network.js";

const sourceUrl = "https://brand.example/products/mask";
const reference = { uid: "123456789012", host: "store.tildaapi.pro" };
const product = { sku: "DEMO-30", title: "Demo alginate mask", brand: "Demo", volumeValue: 30, volumeUnit: "g" };
const row = {
  uid: reference.uid, url: sourceUrl, title: product.title,
  json_options: JSON.stringify([{ title: "Package" }]),
  gallery: [{ img: "https://static.tildacdn.pro/parent.jpg" }],
  editions: [
    { sku: "DEMO-210", Package: "Jar 210 g", img: "https://static.tildacdn.pro/jar.jpg" },
    { sku: "DEMO-30", Package: "Sachet 30 g", img: "https://static.tildacdn.pro/sachet.jpg" },
  ],
};
const input = { reference, sourceUrl, product, brandConfirmed: true };

test("Tilda binds the page UID and selects only the requested edition photo", async () => {
  const found = await readTildaEdition(input, async (url, body) => {
    assert.equal(url, "https://store.tildaapi.pro/api/getproductsbyuid/");
    assert.deepEqual(body, { productsuid: [reference.uid] });
    return { products: [row] };
  });
  assert.equal(found?.sku, "DEMO-30");
  assert.deepEqual(found?.images, ["https://static.tildacdn.pro/sachet.jpg"]);
  assert.match(found!.title, /30 g/);
  const other = await readTildaEdition({ ...input, product: { ...product, sku: "DEMO-210", volumeValue: 210 } }, async () => ({ products: [row] }));
  assert.deepEqual(other?.images, ["https://static.tildacdn.pro/jar.jpg"]);
});

test("missing photos, duplicate editions and mismatched package evidence do not inherit a parent gallery", async () => {
  const noPhoto = { ...row, editions: row.editions.map(edition => ({ ...edition, img: "" })) };
  assert.deepEqual((await readTildaEdition(input, async () => ({ products: [noPhoto] })))?.images, []);
  assert.equal(await readTildaEdition(input, async () => ({ products: [{ ...row, editions: [...row.editions, row.editions[1]] }] })), null);
  assert.equal(await readTildaEdition({ ...input, product: { ...product, volumeValue: 1000 } }, async () => ({ products: [row] })), null);
  assert.equal(await readTildaEdition({ ...input, brandConfirmed: false }, async () => ({ products: [{ ...row, title: "Alginate mask" }] })), null);
});

test("a catalog response cannot substitute another UID, product page or API host", async () => {
  for (const changed of [{ ...row, uid: "999999999999" }, { ...row, url: "https://brand.example/products/other" }]) {
    await assert.rejects(readTildaEdition(input, async () => ({ products: [changed] })), /source_catalog_product_mismatch/);
  }
  await assert.rejects(readTildaEdition({ ...input, reference: { ...reference, host: "untrusted.example" } }, async () => {
    throw new Error("network must not run");
  }), /source_catalog_reference_invalid/);
  assert.deepEqual(extractTildaReference(Buffer.from('<div id="allrecords" data-tilda-root-zone="pro"><div class="js-store-product_single" data-product-gen-uid="123456789012"></div></div>')), reference);
});

test("account dialogs do not hide the single OpenCart product and its labeled SKU", () => {
  const html = Buffer.from('<div class="ajax-container"><h1>Login</h1><h1>Register</h1></div><div id="content"><h1>Demo cream 50 ml</h1><ul class="list-unstyled"><li>Артикул: CREAM-50</li></ul><div class="product-zoom-image"><img src="/cream.jpg"></div><div id="product"></div></div>');
  const photos = extractImagesForProduct({ buffer: html, finalUrl: "https://brand.example/cream",
    product: { sku: "CREAM-50", title: "Demo cream 50 ml", brand: "Demo", volumeValue: 50, volumeUnit: "ml" } });
  assert.deepEqual(photos, ["https://brand.example/cream.jpg"]);
});

test("bounded catalog JSON uses a read request body and preserves the source origin", async () => {
  const reply = await safeFetchExternal("https://store.tildaapi.pro/api/getproductsbyuid/", {
    policies: [{ domain: "store.tildaapi.pro", allowSubdomains: false }], acceptedContentTypes: ["application/json"],
    maxBytes: 1000, jsonBody: { productsuid: [reference.uid] }, sourceUrl,
  }, {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetcher: (async (_url, options) => {
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), { productsuid: [reference.uid] });
      assert.equal(new Headers(options?.headers).get("origin"), "https://brand.example");
      return new Response('{"products":[]}', { headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  assert.equal(reply.status, 200);
});
