import assert from "node:assert/strict";
import test from "node:test";
import { isOrderFulfillmentAllowed } from "../lib/orderFulfillmentPolicy";

function permitted(paymentMethod: string, paymentStatus: string, orderStatus: string) {
  return isOrderFulfillmentAllowed({ paymentMethod, paymentStatus, orderStatus });
}

test("refunded orders cannot be packed, shipped or completed", () => {
  for (const method of ["KASPI_TRANSFER", "CASH"]) {
    for (const status of ["PACKING", "SHIPPED", "DONE"]) {
      assert.equal(permitted(method, "REFUNDED", status), false);
    }
  }
});

test("Kaspi prepayments must be paid before fulfillment", () => {
  for (const payment of ["UNPAID", "PENDING"]) {
    for (const status of ["PACKING", "SHIPPED", "DONE"]) {
      assert.equal(permitted("KASPI_TRANSFER", payment, status), false);
    }
  }
  for (const status of ["PACKING", "SHIPPED", "DONE"]) {
    assert.equal(permitted("KASPI_TRANSFER", "PAID", status), true);
  }
});

test("cash on delivery can be shipped before payment, not completed", () => {
  assert.equal(permitted("CASH", "DUE_ON_DELIVERY", "PACKING"), true);
  assert.equal(permitted("CASH", "DUE_ON_DELIVERY", "SHIPPED"), true);
  assert.equal(permitted("CASH", "DUE_ON_DELIVERY", "DONE"), false);
  assert.equal(permitted("CASH", "PAID", "DONE"), true);
});

test("unpaid orders can remain NEW or CONFIRMED", () => {
  assert.equal(permitted("KASPI_TRANSFER", "UNPAID", "NEW"), true);
  assert.equal(permitted("KASPI_TRANSFER", "PENDING", "CONFIRMED"), true);
});
