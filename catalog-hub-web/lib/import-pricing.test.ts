import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PRICE_RULE, parsePriceRule, priceImportItems } from "./import-pricing";
import { evaluateImport, type Existing } from "./import-review";

const item = { rowNumber: 2, sku: "SKU-1", barcode: "", title: "Крем", purchasePrice: 1160, price: 1900, errors: [] as string[] };
const existing: Existing = {
  id: "p1", sku: "SKU-1", barcode: null, title: "Крем", brand: null,
  purchasePrice: 1000, price: 1800, description: null, categoryKey: null,
  updatedAt: "2026-10-14T00:00:00Z",
};

test("price rule calculates markup and upward rounding before reviewing an update", () => {
  const priced = priceImportItems([item], { mode: "MARKUP_PERCENT", markupPercent: 20, roundingStep: 100 });
  assert.equal(priced[0].price, 1400);
  const review = evaluateImport(priced, [existing], [])[0];
  assert.equal(review.status, "UPDATE");
  assert.deepEqual(review.changes.map(change => change.field), ["purchasePrice", "price"]);
  assert.equal(item.price, 1900);
});

test("source-only rule stages a purchase price and leaves retail unchanged", () => {
  const priced = priceImportItems([item], { ...DEFAULT_PRICE_RULE, mode: "SOURCE_ONLY" });
  const review = evaluateImport(priced, [existing], [])[0];
  assert.equal(review.status, "UPDATE");
  assert.deepEqual(review.changes, [{ field: "purchasePrice", before: 1000, after: 1160 }]);
  assert.equal(priced[0].price, undefined);
});

test("markup requires a source price; invalid settings are rejected", () => {
  const priced = priceImportItems([{ ...item, purchasePrice: undefined }], {
    ...DEFAULT_PRICE_RULE, mode: "MARKUP_PERCENT",
  });
  assert.equal(evaluateImport(priced, [existing], [])[0].status, "INVALID");
  assert.throws(() => parsePriceRule({ ...DEFAULT_PRICE_RULE, markupPercent: -1 }), /invalid_price_rule/);
  assert.deepEqual(parsePriceRule(undefined), DEFAULT_PRICE_RULE);
});
