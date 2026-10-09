import assert from "node:assert/strict";
import test from "node:test";
import {
  applyApprovedChanges,
  buildCardDiff,
  suggestedApprovalGroups,
} from "./staging.js";

const current = {
  sku: "A001",
  barcode: "487000000001",
  title: "Крем 50 мл",
  brand: "Brand",
  description: "Старое описание",
  categoryKey: "face-cream",
  attributes: {},
  images: ["https://example.com/old.jpg"],
  purchasePrice: 6500,
  price: 9490,
  stock: 7,
};

test("builds field diff with risk classification", () => {
  const diff = buildCardDiff(current, {
    description: "Новое описание",
    images: ["https://example.com/new.jpg"],
    purchasePrice: 6900,
    price: 9990,
    stock: 12,
  });

  assert.equal(diff.summary.total, 5);
  assert.equal(diff.summary.lowRisk, 1);
  assert.equal(diff.summary.mediumRisk, 1);
  assert.equal(diff.summary.highRisk, 3);
});

test("applies only explicitly approved fields", () => {
  const result = applyApprovedChanges({
    current,
    proposed: {
      description: "Новое описание",
      price: 9990,
      stock: 12,
    },
    approvedFields: ["description", "stock"],
  });

  assert.equal(result.revised.description, "Новое описание");
  assert.equal(result.revised.stock, 12);
  assert.equal(result.revised.price, 9490);
  assert.equal(result.fullyApplied, false);
  assert.deepEqual(result.remainingChanges.map((x) => x.field), ["price"]);
});

test("groups text media and commercial changes", () => {
  const groups = suggestedApprovalGroups(current, {
    title: "Крем Brand 50 мл",
    images: ["https://example.com/new.jpg"],
    price: 9990,
  });

  assert.deepEqual(groups.safeText, ["title"]);
  assert.deepEqual(groups.media, ["images"]);
  assert.deepEqual(groups.commercial, ["price"]);
});
