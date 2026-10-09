import assert from "node:assert/strict";
import test from "node:test";
import { detectImportFormat } from "./formats.js";
import { previewUniversalImport } from "./import-engine.js";

test("detects structured catalog formats", () => {
  assert.equal(detectImportFormat({ filename: "catalog.json" }), "json");
  assert.equal(detectImportFormat({ filename: "catalog.xml" }), "xml");
  assert.equal(detectImportFormat({ filename: "catalog.yml" }), "yml");
  assert.equal(detectImportFormat({ filename: "catalog.xlsx" }), "xlsx");
});

test("imports nested JSON catalog through field mapping", () => {
  const result = previewUniversalImport({
    format: "json",
    text: JSON.stringify({
      catalog: {
        products: [
          {
            identity: { sku: "A001", barcode: "487000000001" },
            name: "Крем 50 мл",
            brand: "Brand",
            commerce: { price: 12990, stock: 7 },
          },
        ],
      },
    }),
    collectionPath: "catalog.products",
    mapping: {
      sku: "identity.sku",
      barcode: "identity.barcode",
      title: "name",
      brand: "brand",
      price: "commerce.price",
      stock: "commerce.stock",
    },
  });

  assert.equal(result.format, "json");
  assert.equal(result.validRows, 1);
  assert.equal(result.data[0].product.sku, "A001");
  assert.equal(result.data[0].product.price, 12990);
  assert.ok(result.columns.includes("commerce.stock"));
});

test("imports XML catalog with attributes", () => {
  const result = previewUniversalImport({
    format: "xml",
    text: `
      <catalog>
        <offers>
          <offer sku="XML001">
            <name>Сыворотка</name>
            <brand>Brand X</brand>
            <price>9500</price>
            <stock>4</stock>
          </offer>
        </offers>
      </catalog>
    `,
    collectionPath: "catalog.offers.offer",
    mapping: {
      sku: "@sku",
      title: "name",
      brand: "brand",
      price: "price",
      stock: "stock",
    },
  });

  assert.equal(result.validRows, 1);
  assert.equal(result.data[0].product.sku, "XML001");
  assert.equal(result.data[0].product.stock, 4);
});

test("imports YAML catalog", () => {
  const result = previewUniversalImport({
    format: "yaml",
    text: `
products:
  - sku: Y001
    name: Маска
    brand: Brand Y
    price: 8000
    stock: 3
`,
    collectionPath: "products",
    mapping: {
      sku: "sku",
      title: "name",
      brand: "brand",
      price: "price",
      stock: "stock",
    },
  });

  assert.equal(result.validRows, 1);
  assert.equal(result.data[0].product.title, "Маска");
});
