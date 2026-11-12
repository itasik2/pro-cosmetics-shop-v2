import assert from "node:assert/strict";
import test from "node:test";
import { auditCatalogHubPilot, PILOT_AUDIT_LIMIT, type PilotStoreProduct, type PilotHubProduct } from "../lib/catalogHubPilotAudit";

function product(id: string, supplierSku: string, variants: unknown = null): PilotStoreProduct {
  return { id, supplierSku, name: "Cream", brand: "Brand", barcode: null, price: 1500, stock: 4, variants };
}
function hub(sku: string, overrides: Partial<PilotHubProduct> = {}): PilotHubProduct {
  return { id: "hub-" + sku, sku, title: "Cream", brand: "brand", barcode: null, price: 1500, available: 4, ...overrides };
}
function variant(id: string, sku: string | null, price = 1500, stock = 4) {
  return { id, sku, label: "50 ml", price, stock };
}

test("pilot compares sellable variants using their own SKUs and available stock", () => {
  const report = auditCatalogHubPilot({
    products: [product("group", "PARENT", [variant("a", "SKU-50"), variant("b", null)])],
    hubProducts: [hub("PARENT"), hub("SKU-50", { title: "Cream · 50 ml", available: 2 })],
    ordersByStatus: [],
    orderLines: [],
  });
  assert.equal(report.summary.offers, 2);
  assert.equal(report.summary.hubOnly, 1);
  assert.deepEqual(report.comparisons.map(row => [row.variantId, row.status]), [["a", "DIFF"], ["b", "NO_SKU"]]);
  assert.deepEqual(report.comparisons[0].differences, [{ field: "available", store: 4, hub: 2 }]);
  assert.equal(report.comparisons[1].hubProductId, undefined);
});

test("pilot flags ambiguous SKU, mismatched identity, and malformed stock instead of creating mappings", () => {
  const report = auditCatalogHubPilot({
    products: [
      product("first", "DUP"), product("second", "DUP"), product("third", "HUB-DUP"),
      { ...product("other-brand", "BRAND"), brand: "Other" },
      { ...product("other-barcode", "BAR"), barcode: "12345" },
      product("bad-stock", "BAD", [variant("x", "STOCK", 1500, -1)]),
      product("duplicate-id", "PARENT", [variant("x", "LEFT"), variant("x", "RIGHT")]),
    ],
    hubProducts: [hub("DUP"), hub("HUB-DUP"), hub("HUB-DUP"), hub("BRAND"), hub("BAR", { barcode: "999" }), hub("STOCK"), hub("LEFT"), hub("RIGHT")],
    ordersByStatus: [], orderLines: [],
  });
  assert.deepEqual(report.comparisons.map(row => row.status), [
    "AMBIGUOUS", "AMBIGUOUS", "AMBIGUOUS", "IDENTITY_CONFLICT", "IDENTITY_CONFLICT", "INVALID", "INVALID", "INVALID",
  ]);
  assert.ok(report.comparisons.every(row => row.hubProductId === undefined));
});

test("pilot checks recorded order identities without substituting a current or parent SKU", () => {
  const report = auditCatalogHubPilot({
    products: [product("p", "P", [variant("v", "V")])],
    hubProducts: [hub("V", { title: "Cream · 50 ml" })],
    ordersByStatus: [{ status: "CONFIRMED", count: 3 }, { status: "CANCELED", count: 1 }],
    orderLines: [
      { productId: "p", variantId: "v", sku: "V", qty: 1, status: "CONFIRMED" },
      { productId: "p", variantId: "v", sku: "OLD", qty: 1, status: "CONFIRMED" },
      { productId: "p", variantId: "v", sku: null, qty: 1, status: "CONFIRMED" },
      { productId: "p", variantId: null, sku: "P", qty: 1, status: "CANCELED" },
    ],
  });
  assert.equal(report.summary.counts.MATCH, 1);
  assert.deepEqual(report.summary.orders, {
    total: 4, open: 3, lines: 4, mappedLines: 1, openUnmappedLines: 2, missingSavedSku: 1,
  });
});

test("pilot rejects an incomplete over-limit audit instead of reporting a partial match", () => {
  const oversized = Array.from({ length: PILOT_AUDIT_LIMIT + 1 }, () => variant("x", "X"));
  assert.throws(() => auditCatalogHubPilot({
    products: [product("p", "P", oversized)], hubProducts: [], ordersByStatus: [], orderLines: [],
  }), /catalog_hub_pilot_limit/);
});
