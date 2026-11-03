import test from "node:test";
import assert from "node:assert/strict";
import { available, canonical, nextBalance, orderItems, retryDelay } from "../../marketplace-hub/supabase/functions/catalog-hub/core-domain";
import { kaspiFeed, validateManifest } from "../../marketplace-hub/supabase/functions/catalog-hub/channel-feed";

test("channel buffer and safety stock protect availability without changing physical stock", () => {
  const balance = { onHand: 10, reserved: 3, safetyStock: 2, revision: 0 };
  assert.equal(available(balance, 2), 3);
  assert.deepEqual(nextBalance(balance, 0, 3, 2), { ...balance, reserved: 6, revision: 1 });
  assert.throws(() => nextBalance(balance, 0, 4, 2), /insufficient_available_stock/);
  assert.throws(() => nextBalance(balance, -8, 0), /stock_below_reserved/);
  assert.throws(() => nextBalance(balance, 0, -4), /stock_below_reserved/);
});
test("a shipment changes physical and reserved quantities together", () => {
  assert.deepEqual(nextBalance({ onHand: 1, reserved: 1, safetyStock: 0, revision: 3 }, -1, -1),
    { onHand: 0, reserved: 0, safetyStock: 0, revision: 4 });
});
test("duplicate order lines are aggregated and lock order is deterministic", () => {
  assert.deepEqual(orderItems([{ productId: "B", warehouseId: "W", quantity: 1 },
    { productId: "A", warehouseId: "W", quantity: 1 }, { productId: "B", warehouseId: "W", quantity: 2 }]),
  [{ productId: "A", warehouseId: "W", quantity: 1 }, { productId: "B", warehouseId: "W", quantity: 3 }]);
  assert.throws(() => orderItems([{ productId: "B", warehouseId: "W", quantity: -1 }]), /invalid_quantity/);
});
test("idempotency fingerprints ignore object key order and preserve content", () => {
  assert.equal(canonical({ a: 1, b: { d: 3, c: 2 } }), canonical({ b: { c: 2, d: 3 }, a: 1 }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});
test("backoff has bounded jitter and a one hour ceiling", () => {
  assert.equal(retryDelay(1, 0), 10);
  assert.equal(retryDelay(1, 1), 15);
  assert.ok(retryDelay(1000, 0.9) < 3606);
});
test("a complete feed requires the exact expected SKU set, including uniqueness", () => {
  assert.throws(() => validateManifest(["A", "B"], ["A"]), /incomplete_feed_manifest/);
  assert.throws(() => validateManifest(["A", "B"], ["A", "C"]), /incomplete_feed_manifest/);
  assert.throws(() => validateManifest(["A", "A"], ["A", "A"]), /duplicate_seller_sku/);
  assert.throws(() => validateManifest(null, ["A"]), /expected_seller_skus_required/);
});
test("Kaspi export escapes XML, uses seller SKU and never includes purchase prices", async () => {
  const result = await kaspiFeed("Тест & Co", "123", [{ sellerSku: "SELLER1", title: 'Товар <50>', brand: 'A&B',
    price: 200, availabilities: [{ storeId: "PP1", stockCount: 0 }] }], ["SELLER1"], "2026-11-03T00:00:00.000Z");
  assert.match(result.xml, /Тест &amp; Co/);
  assert.match(result.xml, /Товар &lt;50&gt;/);
  assert.match(result.xml, /available="no"/);
  assert.equal(result.count, 1);
  assert.equal(result.deliveryStatus, "NOT_PUBLISHED");
  assert.doesNotMatch(result.xml, /purchasePrice|organizationId|cost/);
  const later = await kaspiFeed("Тест & Co", "123", [{ sellerSku: "SELLER1", title: 'Товар <50>', brand: 'A&B',
    price: 200, availabilities: [{ storeId: "PP1", stockCount: 0 }] }], ["SELLER1"]);
  assert.equal(later.checksum, result.checksum);
});
