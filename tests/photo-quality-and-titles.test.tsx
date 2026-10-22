import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { productDisplayName } from "../lib/productNames";
import { productMatchesSearch } from "../lib/productSearch";
import { measurePhotoQuality, ratePhotoCandidates } from "../lib/enrichment/ratePhotoCandidates";
import { rankPhotoCandidates } from "../lib/enrichment/photoQuality";
import { automaticPhotoPlan, commonPhotoCandidates } from "../lib/enrichment/automaticPhotos";
import { productMergePlan } from "../lib/productMergePlan";
import type { VariantImageCandidate } from "../lib/enrichment/variantImages";
import { sanitizeProposalTitle } from "../lib/enrichment/proposalText";
import { productForVariant } from "../lib/enrichment/variantPhotoSearch";

const artwork = Buffer.from(`<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="800" fill="white"/><rect x="200" y="100" width="400" height="600" fill="#e8ece8" stroke="black" stroke-width="8"/>
  ${Array.from({ length: 16 }, (_, i) => `<path d="M240 ${160 + i * 28}h${i % 2 ? 210 : 320}" stroke="black" stroke-width="${i % 3 ? 4 : 9}"/>`).join("")}
</svg>`);

test("source sharpness and resolution beat an enlarged blurry copy and a tiny preview", async () => {
  const clear = await sharp(artwork).png().toBuffer();
  const blur = await sharp(clear).blur(12).resize(1600, 1600).png().toBuffer();
  const tiny = await sharp(clear).resize(100, 100).png().toBuffer();
  const [clearQuality, blurQuality, tinyQuality] = await Promise.all(
    [clear, blur, tiny].map(measurePhotoQuality),
  );
  assert.equal(clearQuality.width, 800);
  assert.equal(blurQuality.width, 1600);
  assert.ok(clearQuality.sharpness! > blurQuality.sharpness!);
  const ranked = rankPhotoCandidates([
    { url: "https://cdn.example/blur.png", source: "WEB", quality: blurQuality },
    { url: "https://cdn.example/thumbnail.png", source: "WEB", quality: tinyQuality },
    { url: "https://price.example/original.png", source: "PRICE_LIST", quality: clearQuality },
  ]);
  assert.equal(ranked[0].url, "https://price.example/original.png");
});

test("image inspection is bounded, deduplicated, cached and preserves photos when loading fails", async () => {
  const buffer = await sharp(artwork).png().toBuffer();
  const values: VariantImageCandidate[] = Array.from({ length: 4 }, (_, i) => ({
    url: `https://cdn.example/${i}.png`, source: "WEB",
  }));
  let calls = 0, active = 0, peak = 0;
  const ranked = await ratePhotoCandidates([...values, values[0]], { policies: [] }, async (url) => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (url.endsWith("3.png")) throw new Error("source_timeout");
    return { buffer, finalUrl: url, contentType: "image/png", status: 200, headers: {} };
  });
  assert.equal(calls, 4);
  assert.equal(peak, 2);
  assert.equal(ranked.length, 4);
  assert.equal(ranked.filter((row) => row.quality?.version === 1).length, 3);
  let repeatedCalls = 0;
  await ratePhotoCandidates(ranked.filter((row) => row.quality), { policies: [] }, async () => {
    repeatedCalls++;
    throw new Error("unexpected fetch");
  });
  assert.equal(repeatedCalls, 0);
  const expired = await ratePhotoCandidates(values, { policies: [], deadlineAt: Date.now() - 1 }, async () => {
    repeatedCalls++;
    throw new Error("unexpected fetch");
  });
  assert.equal(repeatedCalls, 0);
  assert.deepEqual(expired, values);
});

test("a clearer sibling supplies the common photo while own SKU assignments and saved choices stay intact", () => {
  const variants = [
    { id: "small", sku: "SKY117/1", label: "3 мл" },
    { id: "large", sku: "SKY117", label: "50 мл" },
  ];
  const small = { url: "https://cdn.example/small.jpg", source: "WEB" as const,
    quality: { width: 120, height: 120, sharpness: 2, version: 1 } };
  const large = { url: "https://cdn.example/large.jpg", source: "WEB" as const,
    quality: { width: 1200, height: 1200, sharpness: 16, version: 1 } };
  const facts = { variantImageCandidates: [
    { variantId: "small", sku: "SKY117/1", candidates: [small] },
    { variantId: "large", sku: "SKY117", candidates: [large] },
    { variantId: "removed", sku: "SKY117", candidates: [{ ...large, url: "https://cdn.example/foreign.jpg", quality: { width: 3000, height: 3000, sharpness: 30 } }] },
  ] };
  const product = { id: "p", name: "Маска", supplierSku: "SKY117/1", image: "/seed/mask.jpg", variants };
  const plan = automaticPhotoPlan(product, facts);
  assert.equal(plan.imageUrl, large.url);
  assert.deepEqual(plan.variantImages.map((row) => [row.sku, row.imageUrl]), [
    ["SKY117/1", small.url], ["SKY117", large.url],
  ]);
  assert.equal(automaticPhotoPlan({ ...product, image: "/saved.jpg" }, facts).imageUrl, null);
  assert.equal(automaticPhotoPlan({ ...product, image: "/saved.jpg" }, facts, { preferBestCommon: true }).imageUrl, large.url);
  const stored = commonPhotoCandidates({ ...product, variants: [variants[0], { ...variants[1], image: large.url }] }, facts)[0];
  assert.equal(stored.url, large.url);
  assert.equal(stored.stored, true);
  assert.equal(stored.quality?.width, 1200);
});

test("legacy thumbnail hints and stored source dimensions guide common photos during variant merges", () => {
  const primary = { id: "a", name: "Крем 3 мл", supplierSku: "SKU-3", variants: [
    { id: "a3", sku: "SKU-3", label: "3 мл", price: 1000, stock: 2, image: "/a.jpg" },
  ], volumeValue: 3, volumeUnit: "ml", price: 1000, stock: 2, image: "/seed/cream.jpg",
  images: [{ url: "/a.jpg", width: 120, height: 120 }] };
  const other = { ...primary, id: "b", name: "Крем 50 мл", supplierSku: "SKU-50", variants: [
    { id: "b50", sku: "SKU-50", label: "50 мл", price: 7000, stock: 3, image: "/b.jpg" },
  ], volumeValue: 50, price: 7000, stock: 3,
  images: [{ url: "/b.jpg", width: 1200, height: 1200 }] };
  const plan = productMergePlan([primary, other], primary.id);
  assert.equal(plan.image, "/b.jpg");
  assert.equal(plan.commonPhotoSuggestion?.sku, "SKU-50");
  assert.equal(plan.variants[0].image, "/a.jpg");
  assert.equal(plan.variants[1].image, "/b.jpg");
  assert.deepEqual(rankPhotoCandidates([
    { url: "https://cdn.example/resize_cache/160x160/item.jpg" },
    { url: "https://cdn.example/item.jpg?width=1200" },
  ]).map((row) => row.url), ["https://cdn.example/item.jpg?width=1200", "https://cdn.example/resize_cache/160x160/item.jpg"]);
});

test("visible product titles hide known SKUs without removing sizes, SPF, components or longer identifiers", () => {
  const product = { name: "Увлажняющая тканевая маска 7 шт, 3D Skinosophy SKY117", supplierSku: "SKY117" };
  assert.equal(productDisplayName(product), "Увлажняющая тканевая маска 7 шт, 3D Skinosophy");
  assert.equal(productDisplayName({ ...product, name: "Маска — SKU: sky117" }), "Маска");
  assert.equal(productDisplayName({ ...product, name: "Маска (SKY117/1)", variants: [{ sku: "SKY117/1" }] }), "Маска");
  assert.equal(productDisplayName({ ...product, name: "Маска SKY1172" }), "Маска SKY1172");
  for (const code of ["SKY117.2", "SKY117+2", "v2.SKY117", "v2+SKY117"])
    assert.equal(productDisplayName({ ...product, name: `Маска ${code}` }), `Маска ${code}`);
  assert.equal(productDisplayName({ ...product, name: "Маска SKY117.2", supplierSku: "SKY117.2" }), "Маска");
  assert.equal(productDisplayName({ name: "Крем SPF50 Q10, 50 мл, артикул: 50", supplierSku: "50" }), "Крем SPF50 Q10, 50 мл");
  assert.equal(productDisplayName({ name: "Крем A+01", supplierSku: "A+01" }), "Крем");
});

test("SKU search still matches a cleaned title through product and variant identifiers", () => {
  const original = { name: "Маска Skinosophy SKY117", supplierSku: "SKY117", brand: { name: "Skinosophy" },
    variants: [{ sku: "SKY117/1", label: "3 мл" }] };
  const before = structuredClone(original);
  const card = { ...original, name: productDisplayName(original) };
  assert.equal(card.name, "Маска Skinosophy");
  for (const query of ["SKY117", "skY117/1", "Skinosophy SKY117/1", "маска 3 мл"])
    assert.equal(productMatchesSearch(card, query), true, query);
  assert.equal(productMatchesSearch(card, "SKY999"), false);
  assert.deepEqual(original, before);
});

test("a shared variant title omits packaging size even before the brand; SKU sizes remain separate and searchable", () => {
  const product = { id: "rose", name: "Омолаживающая альгинатная маска с розой 30 г Skinosophy SKY025",
    supplierSku: "SKY025", barcode: null, brand: { name: "Skinosophy" }, supplier: null,
    volumeValue: 30, volumeUnit: "g", variants: [
      { id: "sachet", sku: "SKY025", label: "Саше 30 г" },
      { id: "jar", sku: "SKY005", label: "Банка 210 г" },
      { id: "bag", sku: "SKY015", label: "Дой-пак 1 кг" },
    ] };
  const before = structuredClone(product);
  const expected = "Омолаживающая альгинатная маска с розой Skinosophy";
  assert.equal(productDisplayName(product), expected);
  assert.equal(sanitizeProposalTitle(product.name, null, product), expected);
  const card = { ...product, name: productDisplayName(product) };
  for (const query of ["SKY025", "SKY005", "SKY015", "маска 210 г", "Дой-пак 1 кг"])
    assert.equal(productMatchesSearch(card, query), true, query);
  const jar = productForVariant(product, product.variants[1]);
  assert.equal(jar.name, expected + " Банка 210 г");
  assert.equal(jar.volumeValue, 210);
  assert.equal(jar.supplierSku, "SKY005");
  assert.deepEqual(product, before);

  for (const [title, cleaned] of [
    ["Крем SPF50 Q10 AHA 5% (50 ml) Brand", "Крем SPF50 Q10 AHA 5% Brand"],
    ["Сыворотка 2 x 1,5 мл Brand", "Сыворотка Brand"],
    ["Маска 3D 7 шт. Skinosophy", "Маска 3D Skinosophy"],
    ["Маска Саше 30 г Skinosophy", "Маска Skinosophy"],
    ["Средство с витамином 100 мг SPF 30", "Средство с витамином 100 мг SPF 30"],
    ["Средство 5 г/100 г Model-30g", "Средство 5 г/100 г Model-30g"],
    ["Средство 5 г / 100 г", "Средство 5 г / 100 г"],
    ["Средство 5 г на 100 г", "Средство 5 г на 100 г"],
  ]) assert.equal(productDisplayName({ ...product, name: title }), cleaned);
  assert.equal(productDisplayName({ ...product, variants: [product.variants[0]] }),
    "Омолаживающая альгинатная маска с розой 30 г Skinosophy");
});
