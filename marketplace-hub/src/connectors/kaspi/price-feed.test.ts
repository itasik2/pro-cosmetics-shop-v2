import assert from "node:assert/strict";
import test from "node:test";
import { buildKaspiPriceFeed } from "./price-feed.js";

test("builds Kaspi XML and escapes text", () => {
  const xml = buildKaspiPriceFeed({
    company: "A&B",
    merchantId: "merchant-1",
    date: "2026-10-06",
    offers: [
      {
        sku: "SKU001",
        model: "Cream <50ml>",
        brand: "Brand",
        price: 12990,
        availabilities: [
          {
            available: true,
            storeId: "PP1",
            stockCount: 7,
            preorderDays: 3,
          },
        ],
      },
    ],
  });

  assert.match(xml, /<company>A&amp;B<\/company>/);
  assert.match(xml, /<model>Cream &lt;50ml&gt;<\/model>/);
  assert.match(xml, /preOrder="3"/);
  assert.match(xml, /stockCount="7"/);
  assert.match(xml, /<price>12990<\/price>/);
});

test("omits preorder when not configured", () => {
  const xml = buildKaspiPriceFeed({
    company: "Company",
    merchantId: "merchant-1",
    offers: [
      {
        sku: "SKU002",
        model: "Serum",
        brand: "Brand",
        price: 10000,
        availabilities: [
          { available: true, storeId: "PP1", stockCount: 2 },
        ],
      },
    ],
  });

  assert.doesNotMatch(xml, /preOrder=/);
});
