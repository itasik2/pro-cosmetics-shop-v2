import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext, PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import ShopGridClient from "../components/ShopGridClient";
import { CATALOG_BATCH_SIZE, observeListEnd } from "../lib/progressiveList";
import { productThumbnail } from "../lib/productThumbnails";
import { selectedVisibleProducts } from "../lib/adminProductFilters";
import { productMatchesSearch } from "../lib/productSearch";

const products = Array.from({ length: 346 }, (_, n) => ({ id: `product-${n}`, slug: `cream-${n}`,
  name: `Крем ${n}`, supplierSku: `SKU-${n}`, price: 1000, stock: 2, image: "/cream.jpg", category: "Кремы",
  isPopular: false, createdAt: "2026-01-01", brand: { name: "Brand" }, variants: null }));
const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
function render(ui: React.ReactNode, params = "", pathname = "/shop") {
  return renderToStaticMarkup(<AppRouterContext.Provider value={router as any}>
    <PathnameContext.Provider value={pathname}><SearchParamsContext.Provider value={new URLSearchParams(params)}>
      {ui}
    </SearchParamsContext.Provider></PathnameContext.Provider>
  </AppRouterContext.Provider>);
}

test("the catalog starts with a small batch and automatically reveals the rest without page controls", () => {
  const html = render(<ShopGridClient products={products} />);
  assert.equal((html.match(/aria-label="Открыть товар:/g) || []).length, CATALOG_BATCH_SIZE);
  assert.match(html, /Показано 24 из 346/);
  assert.match(html, /Остальные товары появятся при прокрутке/);
  assert.doesNotMatch(html, /Страниц|>Далее<|>Назад<|href="[^\"]*page=/);
  assert.doesNotMatch(html, /Открыть товар: Крем 345/);
});

test("old page parameters do not hide earlier products in the continuous list", () => {
  const html = render(<ShopGridClient products={products} />, "brand=brand&q=cream&page=15");
  assert.equal((html.match(/aria-label="Открыть товар:/g) || []).length, CATALOG_BATCH_SIZE);
  assert.match(html, /Открыть товар: Крем 0/);
  assert.match(html, /Показано 24 из 346/);
});

test("search and bulk selection cover products beyond the initially rendered batch", () => {
  const searched = products.filter(product => productMatchesSearch(product, "SKU 345"));
  const html = render(<ShopGridClient products={searched} />);
  assert.match(html, /Открыть товар: Крем 345/);
  assert.match(html, /Показано 1 из 1/);
  const selected = new Set(products.map(product => product.id));
  assert.equal(selectedVisibleProducts(products, selected).length, 346);
});

test("brand grids load continuously without inheriting catalog-only favorites filters", () => {
  const html = render(<ShopGridClient products={products} layout="brand" />, "fav=1&page=2", "/brand/brand");
  assert.equal((html.match(/aria-label="Открыть товар:/g) || []).length, 24);
  assert.match(html, /Открыть товар: Крем 0/);
  assert.match(html, /Показано 24 из 346/);
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

