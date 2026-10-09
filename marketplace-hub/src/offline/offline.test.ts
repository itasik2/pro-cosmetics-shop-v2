import assert from "node:assert/strict";
import test from "node:test";
import { mapRows, parseCsv } from "./importer.js";
import { validateMasterCard } from "./master-card.js";

test("imports mapped supplier CSV into normalized products", () => {
  const rows = parseCsv(
    'Артикул;Название;Бренд;Цена;Остаток\nA001;"Крем; 50 мл";Brand;12 990;7',
  );

  const mapped = mapRows(rows, {
    sku: "Артикул",
    title: "Название",
    brand: "Бренд",
    price: "Цена",
    stock: "Остаток",
  });

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].valid, true);
  assert.equal(mapped[0].product.title, "Крем; 50 мл");
  assert.equal(mapped[0].product.price, 12990);
  assert.equal(mapped[0].product.stock, 7);
});

test("validates master card and returns completeness warnings", () => {
  const result = validateMasterCard({
    sku: "A001",
    title: "Крем 50 мл",
    price: 12990,
    stock: 7,
  });

  assert.equal(result.valid, true);
  if (result.valid) {
    assert.ok(result.warnings.includes("Brand is not set"));
    assert.ok(result.warnings.includes("Images are not set"));
  }
});
