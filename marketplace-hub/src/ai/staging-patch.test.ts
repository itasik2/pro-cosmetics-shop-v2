import test from "node:test";
import assert from "node:assert/strict";
import { buildEnrichmentPatch } from "./staging-patch.js";

test("enrichment fills gaps while preserving existing copy, brand and images", () => {
  const current = { brand: "Approved Brand", description: "Reviewed description", application: " ", images: ["https://brand.example/original.jpg"], price: 1000, stock: 12 };
  const patch = buildEnrichmentPatch({ current, proposal: { brand: "New Brand", description: "New description", ingredients: "Aqua", application: "Apply daily" },
    includeBrand: true, selectedImageUrl: "https://brand.example/new.jpg" });
  assert.deepEqual(patch, { application: "Apply daily", ingredients: "Aqua" });
  assert.equal(current.description, "Reviewed description");
});
test("explicit replacement is limited to enrichment fields", () => {
  const patch = buildEnrichmentPatch({ current: { description: "Old", images: ["https://brand.example/old.jpg"] },
    proposal: { description: "New" }, replaceFilledFields: true, selectedImageUrl: "https://brand.example/new.jpg" });
  assert.deepEqual(patch, { description: "New", images: ["https://brand.example/new.jpg"] });
  assert.equal("price" in patch, false);
  assert.equal("stock" in patch, false);
});
test("identical or empty suggestions produce no changes", () => {
  assert.deepEqual(buildEnrichmentPatch({ current: { description: "Reviewed" }, proposal: { description: "Reviewed", ingredients: " " }, replaceFilledFields: true }), {});
});
