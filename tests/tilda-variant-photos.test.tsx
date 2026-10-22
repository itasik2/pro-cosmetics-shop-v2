import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { tildaCatalogProductUrls, tildaProductReference, tildaVariantPhoto } from "../lib/enrichment/tildaCatalog";
import { safeFetchExternal, safeFetchCatalogJson } from "../lib/enrichment/network";
import { extractImagesForSku, extractProductFromHtml } from "../lib/enrichment/extractProduct";
import { scoreProductMatch } from "../lib/enrichment/matchProduct";
import { collectProposalPhotos } from "../lib/enrichment/prepareProposalPhotos";
import { searchVariantPhotos } from "../lib/enrichment/variantPhotoSearch";
import { automaticPhotoPlan } from "../lib/enrichment/automaticPhotos";
import { officialCatalogSearchUrls } from "../lib/enrichment/officialCatalogSearch";
import { enrichmentFailureMessage, variantPhotoSearchIssue } from "../lib/enrichment/clientMessages";
import { isRecoverableSourceError } from "../lib/enrichment/resolveProductSource";

const productPage = readFileSync("tests/fixtures/skinosophy-mint-product.html");
const catalogPage = readFileSync("tests/fixtures/skinosophy-mint-catalog.html");
const api = JSON.parse(readFileSync("tests/fixtures/skinosophy-mint-api.json", "utf8"));
const pageUrl = "https://skinosophy.kz/catalog/ohlazhdayushaya-alginatnaya-maska-s-myatoy";
const catalogUrl = "https://skinosophy.kz/catalog";
const variants = [
  { id: "small", sku: "SKY026", label: "Саше 30 г", price: 2500, stock: 1 },
  { id: "jar", sku: "SKY006", label: "Банка 210 г", price: 10100, stock: 2 },
  { id: "bag", sku: "SKY016", label: "Дой-пак 1 кг", price: 30500, stock: 3 },
];
const product = { id: "mint", name: "Охлаждающая альгинатная маска с мятой", supplierSku: "SKY026", barcode: null,
  volumeValue: 30, volumeUnit: "g", brand: { name: "Skinosophy" }, supplier: { name: "Supplier" },
  image: "/seed/mask.jpg", variants };
const officialDomains = ["skinosophy.kz"];
const readJson: typeof safeFetchCatalogJson = async (rawUrl, policies, options) => {
  const url = new URL(rawUrl);
  assert.equal(url.hostname, "store.tildaapi.pro");
  assert.deepEqual(policies, [{ domain: "store.tildaapi.pro", allowSubdomains: false }]);
  assert.equal(new URL(options.sourceUrl).origin, "https://skinosophy.kz");
  if (url.pathname === "/api/getproductsbyuid/") {
    assert.deepEqual((options.jsonBody as { productsuid: string[] }).productsuid, ["452411431282"]);
  } else {
    assert.equal(url.pathname, "/api/getproductslist/");
    assert.equal(url.searchParams.get("storepartuid"), "679462703672");
    assert.equal(options.jsonBody, undefined);
  }
  return structuredClone(api);
};

test("the official Tilda catalog supplies each exact SKU edition without using its shared or stale gallery", async () => {
  assert.deepEqual(tildaProductReference(productPage), { uid: "452411431282", host: "store.tildaapi.pro" });
  assert.deepEqual(officialCatalogSearchUrls(officialDomains, "SKY006"), [catalogUrl]);
  assert.deepEqual(await tildaCatalogProductUrls({ buffer: catalogPage, finalUrl: catalogUrl, product,
    sku: "SKY006", deadlineAt: Date.now() + 5000 }, readJson), [pageUrl]);
  const before = structuredClone(product);
  const photos = await collectProposalPhotos({ product, groups: [], knownUrl: "", officialDomains,
    policies: [{ domain: "skinosophy.kz", allowSubdomains: false }], deadlineAt: Date.now() + 5000 },
  (input) => searchVariantPhotos(input, {
    official: async () => { assert.fail("the official catalog already has the SKU"); },
    external: async () => { assert.fail("no external or AI fallback is needed"); },
    fetchJson: readJson,
    fetchHtml: async (url) => ({ finalUrl: url, buffer: url === catalogUrl ? catalogPage : productPage,
      contentType: "text/html", status: 200, headers: {} }),
  }));
  assert.deepEqual(photos.photoAutomation.issues, []);
  assert.equal(photos.photoAutomation.incomplete, false);
  const selected = automaticPhotoPlan(product, photos).variantImages;
  assert.deepEqual(selected.map((row) => [row.sku, row.imageUrl]), api.products[0].editions.map((row: { sku: string; img: string }) => [row.sku, row.img]));
  assert.equal(new Set(selected.map((row) => row.imageUrl)).size, 3);
  assert.deepEqual(product, before);
  assert.deepEqual(extractImagesForSku({ buffer: productPage, finalUrl: pageUrl, sku: "SKY026" }), []);
  const staticDefault = Buffer.from(productPage.toString().replace('<span class="js-product-sku"></span>', '<span class="js-product-sku">SKY026</span>'));
  assert.deepEqual(extractImagesForSku({ buffer: staticDefault, finalUrl: pageUrl, sku: "SKY026" }), []);
});

test("catalog metadata cannot replace another product, SKU, package size or edition's own missing image", async () => {
  const input = { buffer: productPage, finalUrl: pageUrl, product, sku: "SKY006", officialDomains, deadlineAt: Date.now() + 5000 };
  const changed = (edit: (data: typeof api) => void): typeof safeFetchCatalogJson => async () => {
    const value = structuredClone(api); edit(value); return value;
  };
  await assert.rejects(tildaVariantPhoto(input, changed((data) => { data.products[0].uid = 999999999999; })), /source_catalog_product_mismatch/);
  for (const edit of [
    (data: typeof api) => { data.products[0].url = "https://attacker.example/mask"; data.products[0].buttonlink = ""; },
    (data: typeof api) => { data.products[0].title = "Омолаживающая альгинатная маска с розой"; },
    (data: typeof api) => { data.products[0].editions[1].img = ""; },
    (data: typeof api) => { data.products[0].editions[1].img = "https://attacker.example/jar.png"; },
    (data: typeof api) => { data.products[0].editions[1].sku = "SKY006/1"; },
    (data: typeof api) => { data.products[0].editions.push(data.products[0].editions[1]); },
  ]) assert.equal(await tildaVariantPhoto(input, changed(edit)), null);
  let requested = false;
  assert.equal(await tildaVariantPhoto({ ...input, officialDomains: ["other-brand.example"] }, async () => { requested = true; }), null);
  assert.equal(tildaProductReference(Buffer.from(productPage.toString().replace('data-tilda-root-zone="pro"', 'data-tilda-root-zone="attacker.example"'))), null);
  assert.equal(requested, false);

  const result = await searchVariantPhotos({ product, variant: variants[1], knownUrl: pageUrl,
    officialDomains, policies: [], priceCandidates: [], catalogOnly: true, deadlineAt: Date.now() + 5000 }, {
    official: async () => ({ found: false, url: null }), external: async () => ({ found: false, url: null }),
    fetchJson: changed((data) => { data.products[0].editions[1]["Упаковка"] = "Саше — 30 г"; }),
    fetchHtml: async (url) => ({ finalUrl: url, buffer: productPage, contentType: "text/html", status: 200, headers: {} }),
  });
  assert.deepEqual(result.candidates, []);
});

test("Tilda catalog pagination is bounded and rejects a same-SKU row from another product", async () => {
  let requests = 0;
  const links = await tildaCatalogProductUrls({ buffer: catalogPage, finalUrl: catalogUrl, product,
    sku: "SKY006", deadlineAt: Date.now() + 5000 }, async () => {
    if (++requests === 1) return { total: 200, products: Array.from({ length: 100 }, () => ({
      ...api.products[0], title: "Чужая маска с другой формулой",
    })) };
    return api;
  });
  assert.equal(requests, 2);
  assert.deepEqual(links, [pageUrl]);
  requests = 0;
  assert.deepEqual(await tildaCatalogProductUrls({ buffer: catalogPage, finalUrl: catalogUrl, product,
    sku: "MISSING", deadlineAt: Date.now() + 5000 }, async () => {
    requests++; return { total: 1000, products: Array.from({ length: 100 }, () => ({ title: "Other", sku: "OTHER" })) };
  }), []);
  assert.equal(requests, 2);
});

test("a blocked HTTP-200 source is reported as unavailable instead of being cached as no photo", async () => {
  const denied = '<html><head><title>22.10.2026</title><style>.antibot-btn-success{display:block}</style></head><body><h3>Sorry, your request has been denied.</h3></body></html>';
  const options = { policies: [{ domain: "example.com", allowSubdomains: false }], maxBytes: 10000, acceptedContentTypes: ["text/html"] };
  const dependencies = { resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetcher: async () => new Response(denied, { headers: { "Content-Type": "text/html" } }) };
  await assert.rejects(safeFetchExternal("https://example.com/mask", options, dependencies), /source_access_blocked/);
  assert.equal(variantPhotoSearchIssue("source_access_blocked").code, "source_access_blocked");
  assert.match(enrichmentFailureMessage("source_access_blocked"), /не означает, что фото отсутствует/);
  assert.equal(isRecoverableSourceError("source_access_blocked"), true);
  const regular = '<html><title>Охлаждающая маска</title><script>var captcha="verify you are human";</script><h1>Маска Skinosophy</h1></html>';
  const accepted = await safeFetchExternal("https://example.com/mask", options, { ...dependencies,
    fetcher: async () => new Response(regular, { headers: { "Content-Type": "text/html" } }) });
  assert.equal(accepted.status, 200);
});

test("public catalog requests use the source origin, retain DNS protections and never forward source query parameters", async () => {
  const url = "https://store.tildaapi.pro/api/getproductsbyuid/";
  const policies = [{ domain: "store.tildaapi.pro", allowSubdomains: false }];
  const options = { sourceUrl: pageUrl + "?token=do-not-forward", jsonBody: { productsuid: ["452411431282"] } };
  const result = await safeFetchCatalogJson(url, policies, options, {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetcher: async (target, init) => {
      assert.equal(String(target), url);
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Origin"), "https://skinosophy.kz");
      assert.equal(headers.get("Referer"), "https://skinosophy.kz/");
      assert.match(headers.get("User-Agent") || "", /ProCosmeticsSourceMonitor/);
      assert.deepEqual(JSON.parse(String(init?.body)), options.jsonBody);
      return Response.json(api);
    },
  });
  assert.deepEqual(result, api);
  await assert.rejects(safeFetchCatalogJson(url, policies, options, {
    resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
    fetcher: async () => { assert.fail("a private address must never receive the catalog request"); },
  }), /source_dns_blocked/);
});

test("photo matching compares kilograms, litres and decimal package sizes in the same base units", () => {
  for (const [label, amount, unit] of [
    ["1 кг", 1000, "g"], ["0,5 кг", 500, "g"], ["0.25 kg", 250, "g"],
    ["1 л", 1000, "ml"], ["0,5 l", 500, "ml"], ["2,5 г", 2.5, "g"],
  ] as const) {
    const extracted = extractProductFromHtml({ buffer: Buffer.from(`<h1>Маска ${label}</h1>`), finalUrl: pageUrl });
    assert.equal(scoreProductMatch({ ...product, volumeValue: amount, volumeUnit: unit }, extracted).evidence.volume, "match", label);
    assert.equal(scoreProductMatch({ ...product, volumeValue: amount + 1, volumeUnit: unit }, extracted).evidence.volume, "mismatch", label);
  }
});
