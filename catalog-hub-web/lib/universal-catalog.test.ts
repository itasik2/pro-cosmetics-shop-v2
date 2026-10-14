import test from "node:test";
import assert from "node:assert/strict";
import { buildUniversalCatalog, supplierVolume, missingEnrichmentFields } from "./universal-catalog";
import { evaluateImport } from "./import-review";

test("supplier draft preserves unknown prices, source coordinates and variant without inventing stock or supplier SKU", () => {
  const items = [{ rowNumber: 2, sku: "JDR-INTERNAL", barcode: "", title: "Cream 50 мл", volume: "50 мл", price: 28000, errors: [] }];
  const rows = [{ Артикул: "JDR-INTERNAL", Название: "Cream 50 мл", Объем: "50 мл", Страница: "3", "Цена 1": "18700", "Цена 2": "28000" }];
  const result = buildUniversalCatalog({ fileName: "supplier.pdf", fileSha256: "a".repeat(64),
    table: { format: "PDF", headers: Object.keys(rows[0]), rows },
    mapping: { sku: "Артикул", title: "Название", volume: "Объем", price: "Цена 2" },
    items, originalRows: [{ ...rows[0], Артикул: "" }], review: evaluateImport(items, [], []) });
  const product = result.products[0];
  assert.equal(product.identity.internalSku, "JDR-INTERNAL");
  assert.equal(product.identity.supplierSku, null);
  assert.equal(product.prices.purchase, null);
  assert.deepEqual(product.prices.sourceAmounts.map(p => p.role), ["UNASSIGNED", "RETAIL"]);
  assert.equal(product.provenance.page, 3);
  assert.equal(product.provenance.fields.price.column, "Цена 2");
  assert.deepEqual(product.card.variant, { value: 50, unit: "ml", raw: "50 мл" });
  assert.equal(product.inventory.ownQuantity, null);
  assert.ok(product.enrichment.missingFields.includes("images"));
  assert.equal(result.purpose, "INTERNAL_REVIEW");
});
test("unrecognized or compound packaging remains unknown", () => {
  assert.equal(supplierVolume("50 мл + 100 мл"), null);
  assert.equal(supplierVolume("0 ml"), null);
  assert.deepEqual(supplierVolume("0,5 кг"), { value: 0.5, unit: "kg", raw: "0,5 кг" });
});
test("enrichment gaps concern descriptive data, never prices, barcodes or quantities", () => {
  const gaps = missingEnrichmentFields({ brand: "Brand", description: "  ", images: [] });
  assert.ok(!gaps.includes("brand"));
  assert.ok(gaps.includes("description"));
  assert.ok(gaps.includes("images"));
  assert.equal(gaps.some(f => ["price", "stock", "barcode"].includes(f)), false);
});
