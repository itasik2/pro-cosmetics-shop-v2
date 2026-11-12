import assert from "node:assert/strict";
import test from "node:test";
import { buildOrderFromCart } from "../lib/order";

const product = {
  id: "cream",
  name: "Крем",
  price: 5000,
  stock: 3,
  image: "/cream.jpg",
  variants: [
    { id: "small", label: "30 мл", price: 6000, stock: 2 },
    { id: "large", label: "50 мл", price: 8000, stock: 1 },
  ],
};

const fakeDb = {
  product: {
    findMany: async () => [product],
  },
} as unknown as NonNullable<Parameters<typeof buildOrderFromCart>[1]>;

test("checkout never substitutes a removed variant with the base product", async () => {
  const built = await buildOrderFromCart(
    [{ id: "cream:deleted", qty: 1 }],
    fakeDb,
  );
  assert.equal(built.error, "nothing_to_order");
  assert.deepEqual(built.items, []);
});

test("duplicate cart keys do not oversell stock or double charge", async () => {
  const built = await buildOrderFromCart(
    [
      { id: "cream:small", qty: 2 },
      { id: "cream:small", qty: 1 },
      { id: "cream:small:malformed", qty: 2 },
      { id: "cream", qty: 1 },
      { id: "cream:base", qty: 1 },
    ],
    fakeDb,
  );
  assert.equal(built.error, null);
  assert.equal(built.items.length, 2);
  assert.equal(built.total, 17000);
  assert.deepEqual(
    built.items.map(({ variantId, qty }) => ({ variantId, qty })),
    [{ variantId: "small", qty: 2 }, { variantId: null, qty: 1 }],
  );
});

test("different available variants remain separate order lines", async () => {
  const built = await buildOrderFromCart(
    [
      { id: "cream:small", qty: 1 },
      { id: "cream:large", qty: 1 },
    ],
    fakeDb,
  );
  assert.equal(built.total, 14000);
  assert.deepEqual(built.items.map((item) => item.variantId), ["small", "large"]);
});
