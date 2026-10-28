import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext, PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import ShopGridClient from "../components/ShopGridClient";
import { CATALOG_INITIAL_SIZE, observeListEnd } from "../lib/progressiveList";
import { productThumbnail } from "../lib/productThumbnails";
import { selectedVisibleProducts } from "../lib/adminProductFilters";
import { productMatchesSearch } from "../lib/productSearch";
import { catalogBatch } from "../lib/catalogBatch";
import { createCatalogPost } from "../lib/catalogApi";
import { mergeCatalogProducts, requestCatalogBatch } from "../lib/catalogClient";
import type { CatalogQuery, CatalogSource } from "../lib/catalogTypes";

const products = Array.from({ length: 346 }, (_, n) => ({ id: `product-${n}`, slug: `cream-${n}`,
  name: `Крем ${n}`, supplierSku: `SKU-${n}`, price: 1000, stock: 2, image: "/cream.jpg", category: "Кремы",
  isPopular: false, createdAt: "2026-01-01", brand: { name: "Brand" }, variants: null }));
const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
const query: CatalogQuery = { brandSlugs: [], categorySlugs: [], sort: "", fav: "", instock: "", searchQuery: "", care: "", maxPrice: null };
const source: CatalogSource = { kind: "catalog", query };
const initial = catalogBatch(products, CATALOG_INITIAL_SIZE);
function render(ui: React.ReactNode, params = "", pathname = "/shop") {
  return renderToStaticMarkup(<AppRouterContext.Provider value={router as any}>
    <PathnameContext.Provider value={pathname}><SearchParamsContext.Provider value={new URLSearchParams(params)}>
      {ui}
    </SearchParamsContext.Provider></PathnameContext.Provider>
  </AppRouterContext.Provider>);
}

test("the catalog starts with a small batch and automatically reveals the rest without page controls", () => {
  const html = render(<ShopGridClient batch={initial} source={source} />);
  assert.equal((html.match(/aria-label="Открыть товар:/g) || []).length, CATALOG_INITIAL_SIZE);
  assert.match(html, /Показано 6 из 346/);
  const images = html.match(/<img\b[^>]*>/g) || [];
  assert.equal(images.filter((image) => image.includes('loading="eager"')).length, 1);
  assert.equal(images.filter((image) => image.includes('fetchPriority="high"')).length, 1);
  assert.ok(images.slice(1).every((image) => image.includes('loading="lazy"')));
  assert.match(html, /Остальные товары появятся при прокрутке/);
  assert.doesNotMatch(html, /Страниц|>Далее<|>Назад<|href="[^\"]*page=/);
  assert.doesNotMatch(html, /Открыть товар: Крем 345/);
});

test("old page parameters do not hide earlier products in the continuous list", () => {
  const html = render(<ShopGridClient batch={initial} source={source} />, "brand=brand&q=cream&page=15");
  assert.equal((html.match(/aria-label="Открыть товар:/g) || []).length, CATALOG_INITIAL_SIZE);
  assert.match(html, /Открыть товар: Крем 0/);
  assert.match(html, /Показано 6 из 346/);
});

test("search and bulk selection cover products beyond the initially rendered batch", () => {
  const searched = products.filter(product => productMatchesSearch(product, "SKU 345"));
  const html = render(<ShopGridClient batch={catalogBatch(searched, CATALOG_INITIAL_SIZE)} source={source} />);
  assert.match(html, /Открыть товар: Крем 345/);
  assert.match(html, /Показано 1 из 1/);
  const selected = new Set(products.map(product => product.id));
  assert.equal(selectedVisibleProducts(products, selected).length, 346);
});

test("brand grids load continuously without inheriting catalog-only favorites filters", () => {
  const html = render(<ShopGridClient batch={initial} source={{ kind: "brand", slug: "brand" }} layout="brand" />, "fav=1&page=2", "/brand/brand");
  assert.equal((html.match(/aria-label="Открыть товар:/g) || []).length, CATALOG_INITIAL_SIZE);
  assert.match(html, /Открыть товар: Крем 0/);
  assert.match(html, /Показано 6 из 346/);
});

test("each observer reveals once, disconnects, and ignores notifications after cleanup", (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "IntersectionObserver", original);
    else Reflect.deleteProperty(globalThis, "IntersectionObserver");
  });
  let notify!: (entries: { isIntersecting: boolean }[]) => void;
  let disconnects = 0;
  let revealed = 0;
  let observed: unknown;
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { notify = callback; }
    observe(target: unknown) { observed = target; }
    disconnect() { disconnects++; }
  } });
  const target = {} as Element;
  const cleanup = observeListEnd(target, () => revealed++, () => assert.fail("supported observer"));
  assert.equal(observed, target);
  notify([{ isIntersecting: false }]);
  assert.equal(revealed, 0);
  notify([{ isIntersecting: true }]);
  notify([{ isIntersecting: true }]);
  assert.equal(revealed, 1);
  assert.equal(disconnects, 1);
  cleanup();
  const cleanupBeforeIntersection = observeListEnd(target, () => revealed++, () => {});
  cleanupBeforeIntersection();
  notify([{ isIntersecting: true }]);
  assert.equal(revealed, 1);
});

test("browsers without IntersectionObserver receive all items rather than a blocked list", (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: undefined });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "IntersectionObserver", original);
    else Reflect.deleteProperty(globalThis, "IntersectionObserver");
  });
  let revealedAll = false;
  const cleanup = observeListEnd({} as Element, () => assert.fail("incremental loading"), () => { revealedAll = true; });
  assert.equal(revealedAll, true);
  cleanup();
});


test("thumbnails resize the selected asset after its existing processing chain and preserve its identity", () => {
  const original = "https://res.cloudinary.com/cloud/image/upload/e_trim/c_pad,h_1200,w_1200/q_auto:good/v12345/products/bottle.webp";
  const resized = productThumbnail(original, 640);
  assert.equal(resized, "https://res.cloudinary.com/cloud/image/upload/e_trim/c_pad,h_1200,w_1200/q_auto:good/c_limit,h_640,w_640/f_auto,q_auto/v12345/products/bottle.webp");
  assert.ok(resized.endsWith("v12345/products/bottle.webp"));
  assert.equal(original.includes("w_640"), false);
  for (const url of ["/cream.jpg", "https://other.example/photo.jpg", original.replace("/e_trim/", "/s--signed--/e_trim/"),
    original + "?__cld_token=private", original.replace("/v12345", "")]) assert.equal(productThumbnail(url, 640), url);
  assert.equal(productThumbnail(original, 0), original);
});


function request(body: unknown) {
  return new Request("https://shop.example/api/catalog/products", { method: "POST", body: JSON.stringify(body) });
}

test("initial public props contain only the first batch, including no supplier or variant-private fields", () => {
  const row = { ...products[0], supplierId: "private-supplier", sourcePrice: 500, description: "private long copy",
    brand: { name: "Brand", privateToken: "secret" },
    variants: [{ id: "v", label: "50 мл", sku: "SKU-V", image: "/variant.jpg", price: 2500, stock: 3, sourcePrice: 400, privateToken: "secret" }],
  };
  const batch = catalogBatch([row, ...products.slice(1)], CATALOG_INITIAL_SIZE);
  const json = JSON.stringify(batch);
  assert.equal(batch.products.length, 6);
  assert.equal(batch.total, 346);
  assert.ok(json.length < JSON.stringify(products).length / 20);
  assert.doesNotMatch(json, /private|sourcePrice|supplierId|SKU-345/);
  assert.deepEqual(batch.products[0].variants?.[0], { id: "v", label: "50 мл", sku: "SKU-V", image: "/variant.jpg", price: 2500, stock: 3 });
});

test("public batches reach every product exactly once and continue after a cursor when preceding rows change", async () => {
  let rows = products;
  const post = createCatalogPost(async () => rows);
  const all = [...initial.products];
  let offset = initial.nextOffset;
  while (offset < products.length) {
    const response = await post(request({ source, offset, after: all.at(-1)?.id }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const batch = await response.json();
    assert.ok(batch.products.length <= 24);
    assert.ok(batch.nextOffset > offset);
    all.push(...batch.products);
    offset = batch.nextOffset;
  }
  assert.deepEqual(all.map((product) => product.id), products.map((product) => product.id));
  rows = [{ ...products[0], id: "new-product" }, ...products.filter((product) => product.id !== "product-1")];
  const next = await (await post(request({ source, offset: 6, after: "product-5" }))).json();
  assert.equal(next.products[0].id, "product-6");
});

test("favorites and SKU search use the full matched catalog before applying the response limit", async () => {
  let seenSource: CatalogSource | undefined;
  const post = createCatalogPost(async (input) => {
    seenSource = input;
    return input.kind === "catalog" ? products.filter((product) => productMatchesSearch(product, input.query.searchQuery)) : products;
  });
  const searchedSource: CatalogSource = { kind: "catalog", query: { ...query, searchQuery: "SKU 345", brandSlugs: ["brand"], instock: "1", maxPrice: 2000 } };
  const searched = await (await post(request({ source: searchedSource, offset: 0 }))).json();
  assert.deepEqual(seenSource, searchedSource);
  assert.equal(searched.products[0].id, "product-345");
  const favorite = await (await post(request({ source: { kind: "catalog", query: { ...query, fav: "1" } }, offset: 0, favorites: ["product-345"] }))).json();
  assert.equal(favorite.total, 1);
  assert.equal(favorite.products[0].id, "product-345");
  const brand = await (await post(request({ source: { kind: "brand", slug: "brand" }, offset: 0, favorites: ["product-345"] }))).json();
  assert.equal(brand.total, 346);
  assert.equal(brand.products[0].id, "product-0");
});

test("public API rejects invalid batches and returns a retryable failure without exposing backend details", async () => {
  let calls = 0;
  const post = createCatalogPost(async () => { calls++; throw new Error("database-password-secret"); });
  for (const body of [null, { source, offset: -1 }, { source, offset: 0, favorites: Array(2001).fill("id") },
    { source: { kind: "catalog", query: { ...query, maxPrice: 0 } }, offset: 0 }]) {
    assert.equal((await post(request(body))).status, 400);
  }
  assert.equal(calls, 0);
  const response = await post(request({ source, offset: 0 }));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /database-password-secret/);
});

test("catalog transport forwards filters, cursors and cancellation, and handles malformed or failed responses", async () => {
  const controller = new AbortController();
  const input = { source, offset: 6, after: "product-5", favorites: [] };
  let options: RequestInit | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "/api/catalog/products"); options = init;
    return Response.json(catalogBatch(products, 24, 6));
  };
  const data = await requestCatalogBatch(input, controller.signal, fetcher);
  assert.equal(data.products[0].id, "product-6");
  assert.equal(options?.signal, controller.signal);
  assert.equal(options?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(options?.body)), input);
  await assert.rejects(requestCatalogBatch(input, controller.signal, async () => new Response("bad", { status: 503 })), /Не удалось загрузить/);
  await assert.rejects(requestCatalogBatch(input, controller.signal, async () => Response.json({ products: [] })), /Не удалось загрузить/);
  const pending = requestCatalogBatch(input, controller.signal, async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("merging batches retains order and SKU photos, replaces fresh overlapping prices, and removes duplicate IDs", () => {
  const first = catalogBatch(products, 6).products;
  const incoming = [{ ...first[5], price: 2000, variants: [{ id: "v", label: "50 мл", price: 2000, stock: 1, sku: "V", image: "/v.jpg" }] },
    ...catalogBatch(products, 2, 6).products];
  const merged = mergeCatalogProducts(first, incoming);
  assert.deepEqual(merged.map((product) => product.id), products.slice(0, 8).map((product) => product.id));
  assert.equal(merged[5].price, 2000);
  assert.equal(merged[5].variants?.[0].sku, "V");
  assert.equal(merged[5].variants?.[0].image, "/v.jpg");
  assert.equal(first[5].price, 1000);
});
