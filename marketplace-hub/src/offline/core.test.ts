import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseXlsx } from "./xlsx.js";
import { calculatePrice } from "./pricing.js";
import { buildCatalogExport } from "./catalog-export.js";

test("reads XLSX rows for supplier import", () => {
  const sheet = XLSX.utils.json_to_sheet([
    {
      Артикул: "A001",
      Название: "Крем 50 мл",
      Бренд: "Brand",
      Цена: 12990,
      Остаток: 7,
    },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Прайс");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const result = parseXlsx(buffer, "Прайс");

  assert.equal(result.sheet, "Прайс");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]["Артикул"], "A001");
  assert.equal(result.rows[0]["Цена"], "12990");
});

test("applies the first matching pricing rule by priority", () => {
  const result = calculatePrice(7000, [
    {
      name: "High",
      priority: 20,
      minPurchase: 5001,
      markupPercent: 25,
      roundingStep: 10,
    },
    {
      name: "Low",
      priority: 10,
      maxPurchase: 5000,
      markupPercent: 40,
      roundingStep: 10,
    },
  ]);

  assert.equal(result.rule, "High");
  assert.equal(result.price, 8750);
});

test("rounds calculated price upward to configured step", () => {
  const result = calculatePrice(6500, [
    {
      name: "Default cosmetics",
      priority: 1,
      markupPercent: 35,
      roundingStep: 10,
    },
  ]);

  assert.equal(result.price, 8780);
});

test("builds stable catalog export for ProCosmetics", () => {
  const result = buildCatalogExport({
    source: "catalog-hub",
    generatedAt: "2026-10-06T12:00:00.000Z",
    products: [
      {
        sku: "A001",
        title: "Крем 50 мл",
        brand: "Brand",
        price: 12990,
        stock: 7,
        attributes: {},
        images: [],
      },
    ],
  });

  assert.equal(result.version, 1);
  assert.equal(result.products[0].sku, "A001");
  assert.equal(result.products[0].stock, 7);
});
