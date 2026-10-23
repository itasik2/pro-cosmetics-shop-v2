import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { extractImagesForNamedProduct, extractImagesForSku, extractProductFromHtml } from "../lib/enrichment/extractProduct";
import { searchVariantPhotos } from "../lib/enrichment/variantPhotoSearch";
import { collectProposalPhotos } from "../lib/enrichment/prepareProposalPhotos";
import { automaticPhotoPlan } from "../lib/enrichment/automaticPhotos";
import { completedPhotoSearchMessage, PHOTO_AUTOMATION_VERSION } from "../lib/enrichment/photoAutomation";

const buffer = readFileSync("tests/fixtures/vigbo-wipes.html");
const url = "https://dkosmetika.ru/shop/skinosophy-piling-salfetok-s-pha-kislotami-5-sht";
const image = "https://cdn-sh1.vigbo.com/shops/shop/products/26603852/images/wipes.png";
const product = { id: "wipes", name: "Набор пилинг-салфеток для кожи с РНА-кислотами", image: "/seed/cleanser.jpg",
  supplierSku: "SKY429", brandId: "brand", barcode: null, brand: { name: "Skinosophy" }, supplier: null,
  volumeValue: 3, volumeUnit: "ml", variants: [] };
const packageLabel = "Коробка 5х3 мл";
async function search(page = buffer, options: { packageLabel?: string; common?: boolean } = {}) {
  return searchVariantPhotos({ product, variant: { sku: "SKY429", label: "3 ml" }, knownUrl: url,
    officialDomains: [], policies: [], priceCandidates: [], catalogOnly: true,
    allowNamedCommonPhoto: options.common ?? true, packageLabel: options.packageLabel ?? packageLabel,
    deadlineAt: Date.now() + 5000 }, {
    official: async () => ({ found: false, url: null }), external: async () => ({ found: false, url: null }),
    fetchHtml: async () => ({ finalUrl: url, buffer: page, status: 200, contentType: "text/html", headers: {} }),
  });
}

test("a Vigbo product contributes its full owned copy and INCI instead of its short schema text or navigation", () => {
  const data = extractProductFromHtml({ buffer, finalUrl: url });
  assert.match(data.description!, /выравнивать её рельеф/);
  assert.equal(data.ingredients, "Water, Gluconolactone, Lactobionic Acid, Panthenol.");
  assert.match(data.application!, /Не смывайте/);
  assert.equal(data.benefits, null);
  assert.doesNotMatch(data.description!, /ДМАЕ|ботокса|другой бренд|Другой товар|Чужая/);
});

test("a standalone common photo can be verified against the applied price-list pack when the source omits SKU", async () => {
  const result = await search();
  assert.equal(result.status, "FOUND");
  assert.deepEqual(result.candidates.map(row => row.url), [image]);
  const photos = await collectProposalPhotos({ product, groups: [], knownUrl: url, officialDomains: [], policies: [],
    packageLabel, deadlineAt: Date.now() + 5000 }, input => {
    assert.equal(input.allowNamedCommonPhoto, true);
    assert.equal(input.packageLabel, packageLabel);
    return search();
  });
  assert.equal(photos.photoAutomation.version, PHOTO_AUTOMATION_VERSION);
  assert.equal(automaticPhotoPlan(product, photos).imageUrl, image);
  assert.deepEqual(automaticPhotoPlan(product, photos).variantImages, []);
  assert.equal(completedPhotoSearchMessage(product, photos), "Фото товара найдено и подставлено.");
});

test("the common-photo fallback does not apply to variants, conflicting SKUs, missing pack evidence or other formulas", async () => {
  assert.deepEqual((await search(buffer, { common: false })).candidates, []);
  assert.deepEqual((await search(buffer, { packageLabel: "" })).candidates, []);
  assert.deepEqual((await search(buffer, { packageLabel: "Коробка 10х3 мл" })).candidates, []);
  for (const changed of [
    buffer.toString().replaceAll("5 шт.", "10 шт."),
    buffer.toString().replaceAll("PHA-", "BHA-"),
    buffer.toString().replaceAll("Skinosophy", "OtherBrand"),
    buffer.toString().replace('"@type":"Product",', '"@type":"Product","sku":"SKY424",'),
    buffer.toString().replace('"@type":"Product",', '"@type":"Product","hasVariant":{"sku":"SKY424"},'),
  ]) assert.deepEqual((await search(Buffer.from(changed))).candidates, []);
});

test("explicit conflicting volume is rejected even if a set count matches the price list", async () => {
  assert.deepEqual((await search(Buffer.from(buffer.toString().replaceAll("5 шт.", "5х6 мл")))).candidates, []);
  assert.equal((await search(Buffer.from(buffer.toString().replaceAll("5 шт.", "5х3 мл")))).status, "FOUND");
});

test("completion messages report a missing common photo accurately", () => {
  assert.match(completedPhotoSearchMessage(product, {}), /Фото товара не найдено; общее фото отсутствует/);
  const variants = [{ id: "one", sku: "SKY429", label: "5х3 мл" }];
  assert.match(completedPhotoSearchMessage({ ...product, variants }, {}), /общее фото отсутствует/);
  assert.match(completedPhotoSearchMessage({ ...product, variants, image }, {}), /используется общее фото/);
  assert.match(completedPhotoSearchMessage({ ...product, variants: [{ ...variants[0], image }] }, {}), /всех вариантов найдены/);
});

const wooPage = readFileSync("tests/fixtures/woocommerce-micellar.html");
const wooUrl = "https://seller.example/product/micellar/";
const wooPhoto = "https://seller.example/uploads/micellar.png";
const wooProduct = { ...product, name: "Мицеллярная вода с витамином С", supplierSku: "SKY400", volumeValue: 400 };

test("WooCommerce uses the owned full-size gallery instead of duplicate social logos, thumbnails or related galleries", async () => {
  const input = { buffer: wooPage, finalUrl: wooUrl };
  const extracted = extractProductFromHtml(input);
  assert.equal(extracted.sku, "SKY400");
  assert.equal(extracted.singleProduct, true);
  assert.deepEqual(extracted.images, [wooPhoto]);
  assert.deepEqual(extractImagesForSku({ ...input, sku: "SKY400", brand: "Skinosophy" }), [wooPhoto]);
  assert.deepEqual(extractImagesForSku({ ...input, sku: "SKY401", brand: "Skinosophy" }), []);
  const result = await searchVariantPhotos({ product: wooProduct, variant: { sku: "SKY400", label: "400 ml" },
    knownUrl: wooUrl, officialDomains: [], policies: [], priceCandidates: [], catalogOnly: true,
    deadlineAt: Date.now() + 5000 }, {
    official: async () => ({ found: false, url: null }), external: async () => ({ found: false, url: null }),
    fetchHtml: async () => ({ buffer: wooPage, finalUrl: wooUrl, status: 200, contentType: "text/html", headers: {} }),
  });
  assert.deepEqual(result.candidates.map(candidate => candidate.url), [wooPhoto]);
});

test("opaque organization and header logos cannot be reintroduced through Product JSON-LD or social metadata", () => {
  const html = `<head><meta property="og:image" content="/opaque-a.jpg"><meta name="twitter:image" content="/opaque-b.jpg">
    <script type="application/ld+json">${JSON.stringify({ "@graph": [
      { "@type": "Organization", logo: { url: "/opaque-a.jpg" } },
      { "@type": "Product", name: "Skinosophy Мицеллярная вода с витамином С 400 мл", sku: "SKY400",
        brand: "Skinosophy", image: ["/opaque-a.jpg", "/opaque-b.jpg"] },
    ] })}</script></head><body><header><img class="custom-logo" src="/opaque-b.jpg"></header>
    <h1>Skinosophy Мицеллярная вода с витамином С 400 мл</h1></body>`;
  const input = { buffer: Buffer.from(html), finalUrl: wooUrl };
  assert.deepEqual(extractProductFromHtml(input).images, []);
  assert.deepEqual(extractImagesForSku({ ...input, sku: "SKY400", brand: "Skinosophy" }), []);
  assert.deepEqual(extractImagesForNamedProduct({ ...input, product: wooProduct }), []);
});

test("a WooCommerce variable product's shared gallery never becomes an individual SKU photo", () => {
  const variable = Buffer.from(wooPage.toString().replace('<div class="summary">', '<form class="variations_form cart"></form><div class="summary">'));
  assert.equal(extractProductFromHtml({ buffer: variable, finalUrl: wooUrl }).hasVariants, true);
  assert.deepEqual(extractImagesForSku({ buffer: variable, finalUrl: wooUrl, sku: "SKY400" }), []);
  const ambiguous = Buffer.from(wooPage.toString().replace('</main>',
    '<div class="product type-product"><h1 class="product_title">Другой товар</h1></div></main>'));
  assert.equal(extractProductFromHtml({ buffer: ambiguous, finalUrl: wooUrl }).singleProduct, false);
});
