import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext, PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import ShopGridClient from "../components/ShopGridClient";
import ListPagination from "../components/ListPagination";
import { CATALOG_PAGE_SIZE, ADMIN_PRODUCT_PAGE_SIZE, paginateItems } from "../lib/listPagination";
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

test("the catalog renders only one page while retaining links to every remaining product page", () => {
  const html = render(<ShopGridClient products={products} />);
  assert.equal((html.match(/aria-label="Открыть товар:/g) || []).length, CATALOG_PAGE_SIZE);
  assert.match(html, /Страница 1 из 15/);
  assert.match(html, /href="\/shop\?page=2"/);
  assert.doesNotMatch(html, /Открыть товар: Крем 345/);
});

test("direct page URLs preserve filters, clamp stale pages and expose the final product", () => {
  const html = render(<ShopGridClient products={products} />, "brand=brand&q=cream&page=15");
  assert.equal((html.match(/aria-label="Открыть товар:/g) || []).length, 10);
  assert.match(html, /Открыть товар: Крем 345/);
  assert.match(html, /brand=brand&amp;q=cream&amp;page=14/);
  assert.match(html, /Страница 15 из 15/);
  assert.match(render(<ShopGridClient products={products} />, "page=999"), /Страница 15 из 15/);
});

test("filtering and selection cover the whole result set before pagination", () => {
  const searched = products.filter(product => productMatchesSearch(product, "SKU 345"));
  assert.equal(paginateItems(searched, 1, CATALOG_PAGE_SIZE).items[0].id, "product-345");
  const selected = new Set(products.map(product => product.id));
  const page = paginateItems(products, 2, ADMIN_PRODUCT_PAGE_SIZE);
  assert.equal(page.items.length, 30);
  assert.equal(selectedVisibleProducts(products, selected).length, 346);
  assert.equal(selectedVisibleProducts(page.items, selected).length, 30);
});

test("brand grids paginate with brand URLs without inheriting catalog-only favorites filters", () => {
  const html = render(<ShopGridClient products={products} layout="brand" />, "fav=1&page=2", "/brand/brand");
  assert.equal((html.match(/aria-label="Открыть товар:/g) || []).length, 24);
  assert.match(html, /\/brand\/brand\?fav=1&amp;page=3/);
  assert.match(html, /Открыть товар: Крем 24/);
});

test("pagination preserves item order without mutations and handles empty/invalid input", () => {
  const original = [...products];
  const all = Array.from({ length: 15 }, (_, n) => paginateItems(products, n + 1, CATALOG_PAGE_SIZE).items).flat();
  assert.deepEqual(all, original);
  assert.deepEqual(products, original);
  assert.equal(paginateItems(products, NaN, 24).page, 1);
  assert.equal(paginateItems(products, -3, 24).page, 1);
  assert.deepEqual(paginateItems([], 99, 24), { items: [], page: 1, pageCount: 1, total: 0, start: 0, end: 0 });
  assert.throws(() => paginateItems(products, 1, 0), /invalid_page_size/);
});

test("pagination hides redundant controls and disables only unavailable directions", () => {
  assert.equal(render(<ListPagination {...paginateItems([], 1, 24)} onPageChange={() => {}} />), "");
  const html = render(<ListPagination {...paginateItems(products, 1, 24)} onPageChange={() => {}} />);
  assert.match(html, /disabled=""[^>]*>Назад/);
  assert.match(html, />Далее<\/button>/);
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

