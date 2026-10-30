import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext, PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import ShopGridClient from "../components/ShopGridClient";
import DeferredHomeProducts from "../components/DeferredHomeProducts";
import HomeProductCard from "../components/HomeProductCard";
import { CATALOG_INITIAL_SIZE, observeListEnd } from "../lib/progressiveList";
import { productThumbnail } from "../lib/productThumbnails";
import { selectedVisibleProducts } from "../lib/adminProductFilters";
import { productMatchesSearch } from "../lib/productSearch";
import { catalogBatch } from "../lib/catalogBatch";
import { createCatalogPost } from "../lib/catalogApi";
import { mergeCatalogProducts, requestCatalogBatch } from "../lib/catalogClient";
import type { CatalogQuery, CatalogSource } from "../lib/catalogTypes";
import { createCatalogViewCache } from "../lib/catalogViewState";

const products = Array.from({ length: 346 }, (_, n) => ({ id: `product-${n}`, slug: `cream-${n}`,
  name: `Крем ${n}`, supplierSku: `SKU-${n}`, price: 1000, stock: 2, image: "/cream.jpg", category: "Кремы",
  isPopular: false, createdAt: new Date(Date.UTC(2026, 0, 1) - n * 1000).toISOString(), brand: { name: "Brand" }, variants: null }));
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

test("home cards render linked products and the selected in-stock variant before their controls load", () => {
  const product = { ...products[0], image: "/common.jpg", variants: [
    { id: "sold-out", label: "30 мл", price: 1500, stock: 0, image: "/sold-out.jpg" },
    { id: "available", label: "50 мл", price: 2500, stock: 3, image: "/available.jpg" },
  ] };
  const html = render(<DeferredHomeProducts products={[product]} fallback={<HomeProductCard product={product} />} />, "", "/");
  assert.match(html, /aria-label="Открыть товар: Крем 0"/);
  assert.match(html, /src="\/available.jpg"/);
  assert.match(html, /2[\u00a0\u202f ]500 ₸/);
  assert.match(html, /В наличии: 3/);
  assert.match(html, /30 мл · нет/);
  assert.match(html, /href="\/shop\/cream-0"/);
  assert.doesNotMatch(html, /src="\/sold-out.jpg"/);
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
  let cursor = initial.cursor;
  let hasMore = initial.hasMore;
  while (hasMore) {
    const response = await post(request({ source, cursor }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const batch = await response.json();
    assert.ok(batch.products.length > 0 && batch.products.length <= 24);
    assert.notEqual(batch.cursor.id, cursor?.id);
    all.push(...batch.products);
    assert.equal(new Set(all.map((product) => product.id)).size, all.length);
    assert.ok(all.length <= products.length);
    cursor = batch.cursor;
    hasMore = batch.hasMore;
  }
  assert.deepEqual(all.map((product) => product.id), products.map((product) => product.id));
  rows = [{ ...products[0], id: "new-product" }, ...products.filter((product) => product.id !== "product-1")];
  const next = await (await post(request({ source, cursor: initial.cursor }))).json();
  assert.equal(next.products[0].id, "product-6");
});

test("favorites and SKU search use the full matched catalog before applying the response limit", async () => {
  let seenSource: CatalogSource | undefined;
  const post = createCatalogPost(async (input) => {
    seenSource = input;
    return input.kind === "catalog" ? products.filter((product) => productMatchesSearch(product, input.query.searchQuery)) : products;
  });
  const searchedSource: CatalogSource = { kind: "catalog", query: { ...query, searchQuery: "SKU 345", brandSlugs: ["brand"], instock: "1", maxPrice: 2000 } };
  const searched = await (await post(request({ source: searchedSource }))).json();
  assert.deepEqual(seenSource, searchedSource);
  assert.equal(searched.products[0].id, "product-345");
  const favorite = await (await post(request({ source: { kind: "catalog", query: { ...query, fav: "1" } }, favorites: ["product-345"] }))).json();
  assert.equal(favorite.total, 1);
  assert.equal(favorite.products[0].id, "product-345");
  const brand = await (await post(request({ source: { kind: "brand", slug: "brand" }, favorites: ["product-345"] }))).json();
  assert.equal(brand.total, 346);
  assert.equal(brand.products[0].id, "product-0");
});

test("public API rejects invalid batches and returns a retryable failure without exposing backend details", async () => {
  let calls = 0;
  const post = createCatalogPost(async () => { calls++; throw new Error("database-password-secret"); });
  for (const body of [null, { source, offset: -1 }, { source, favorites: Array(2001).fill("id") },
    { source: { kind: "catalog", query: { ...query, maxPrice: 0 } } }]) {
    assert.equal((await post(request(body))).status, 400);
  }
  assert.equal(calls, 0);
  const response = await post(request({ source }));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /database-password-secret/);
});

test("catalog transport forwards filters, cursors and cancellation, and handles malformed or failed responses", async () => {
  const controller = new AbortController();
  const input = { source, cursor: initial.cursor, favorites: [] };
  let options: RequestInit | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "/api/catalog/products"); options = init;
    return Response.json(catalogBatch(products, 24, initial.cursor));
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
    ...catalogBatch(products, 2, initial.cursor).products];
  const merged = mergeCatalogProducts(first, incoming);
  assert.deepEqual(merged.map((product) => product.id), products.slice(0, 8).map((product) => product.id));
  assert.equal(merged[5].price, 2000);
  assert.equal(merged[5].variants?.[0].sku, "V");
  assert.equal(merged[5].variants?.[0].image, "/v.jpg");
  assert.equal(first[5].price, 1000);
});

test("continuation does not skip products when the last loaded product disappears or sells out", async () => {
  let rows = [...products];
  const post = createCatalogPost(async (input) => input.kind === "catalog" && input.query.instock === "1"
    ? rows.filter((product) => product.stock > 0) : rows);
  rows = rows.filter((product) => product.id !== "product-5");
  const removed = await (await post(request({ source, cursor: initial.cursor }))).json();
  assert.equal(removed.products[0].id, "product-6");
  rows = products.map((product) => product.id === "product-5" ? { ...product, stock: 0 } : product);
  const soldOut = await (await post(request({ source: { kind: "catalog", query: { ...query, instock: "1" } }, cursor: initial.cursor }))).json();
  assert.equal(soldOut.products[0].id, "product-6");
});

test("creation-date ties continue by ID even after the cursor row is removed", () => {
  const rows = ["c1", "c3", "c0", "c2"].map((id) => ({ ...products[0], id }));
  const first = catalogBatch(rows, 2);
  assert.deepEqual(first.products.map((product) => product.id), ["c3", "c2"]);
  const next = catalogBatch(rows.filter((product) => product.id !== "c2"), 2, first.cursor);
  assert.deepEqual(next.products.map((product) => product.id), ["c1", "c0"]);
  assert.equal(next.hasMore, false);
});

test("returning from a product restores loaded cards, cursor and anchor without changing filter visits", () => {
  const cache = createCatalogViewCache();
  const batch = catalogBatch(products, 30);
  cache.save("catalog", batch);
  assert.equal(cache.read("catalog"), undefined);
  cache.remember("catalog", batch, "product-24");
  const restored = cache.read("catalog")!;
  assert.equal(restored.batch.products.length, 30);
  assert.deepEqual(restored.batch.cursor, batch.cursor);
  assert.equal(restored.anchor, "product-24");
  assert.equal(cache.read("other-filter"), undefined);
  cache.restored("catalog", "product-24");
  assert.equal(cache.read("catalog"), undefined);
});

test("a completed request during navigation keeps the return anchor and the latest loaded batch", () => {
  const cache = createCatalogViewCache();
  cache.remember("catalog", catalogBatch(products, 30), "product-24");
  const latest = catalogBatch(products, 54);
  cache.save("catalog", latest);
  assert.equal(cache.read("catalog")?.batch.products.length, 54);
  assert.equal(cache.read("catalog")?.anchor, "product-24");
  cache.restored("catalog", "different-product");
  assert.equal(cache.read("catalog")?.anchor, "product-24");
});

test("navigation state is bounded and isolated across catalog queries and favorites", () => {
  const cache = createCatalogViewCache(2);
  cache.remember("catalog", initial, "product-0");
  cache.remember("brand", initial, "product-1");
  cache.remember("favorites", initial, "product-2");
  assert.equal(cache.read("catalog"), undefined);
  assert.equal(cache.read("brand")?.anchor, "product-1");
  assert.equal(cache.read("favorites")?.anchor, "product-2");
  assert.equal(createCatalogViewCache().read("favorites"), undefined);
});
