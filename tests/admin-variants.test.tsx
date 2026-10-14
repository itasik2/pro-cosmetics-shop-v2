import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  adminStockSummary,
  adminVariants,
  variantStockChanges,
} from "../lib/adminProductVariants";
import { VariantSummary } from "../app/admin/(private)/products/ProductVariantsPanel";

const product = {
  id: "test",
  name: "Масло",
  stock: 999,
  variants: [
    {
      id: "small",
      label: "100 мл",
      price: 4500,
      stock: 4,
      sku: "CL01",
      image: "/small.jpg",
    },
    {
      id: "large",
      label: "200 мл",
      price: 7500,
      stock: 2,
      sku: "CL22",
      image: "/large.jpg",
    },
  ],
};

test("admin stock uses variant quantities rather than a stale parent stock", () => {
  const summary = adminStockSummary(product);
  assert.equal(summary.total, 6);
  assert.equal(summary.available, 2);
  assert.equal(summary.variants.length, 2);
  assert.equal(adminStockSummary({ stock: 8 }).total, 8);
  assert.equal(
    adminStockSummary({ stock: 8, variants: [] }).variants.length,
    0,
  );
  assert.equal(
    adminStockSummary({
      ...product,
      variants: [{ ...product.variants[0], stock: 0 }],
    }).available,
    0,
  );
});

test("stock update includes only changed variant IDs and supports zero", () => {
  const variants = adminVariants(product.variants);
  assert.deepEqual(variantStockChanges(variants, {}), []);
  assert.deepEqual(variantStockChanges(variants, { small: "4", large: "0" }), [
    { variantId: "large", stock: 0 },
  ]);
  assert.deepEqual(
    variantStockChanges(variants, { missing: "20", small: "04" }),
    [],
  );
  assert.equal(variants[0].sku, "CL01");
  assert.equal(variants[0].image, "/small.jpg");
});

test("invalid quantities cannot silently erase inventory", () => {
  for (const value of ["", "-1", "1.5", "1e2", "1000001", "Infinity"]) {
    assert.throws(
      () =>
        variantStockChanges(adminVariants(product.variants), { small: value }),
      /Укажите целое количество/,
    );
  }
  assert.equal(
    adminVariants([null, {}, { id: "x", label: "" }, ...product.variants])
      .length,
    2,
  );
});

test("product summary shows each volume, quantities and zero-stock variants", () => {
  const html = renderToStaticMarkup(
    <VariantSummary
      product={{
        ...product,
        variants: [product.variants[0], { ...product.variants[1], stock: 0 }],
      }}
    />,
  );
  assert.ok(html.includes("100 мл"));
  assert.ok(html.includes("200 мл"));
  assert.match(html, /Вариантов: 2 · в наличии: 1/);
  assert.ok(!html.includes("999"));
  assert.ok(html.includes("Остатки вариантов"));
});
