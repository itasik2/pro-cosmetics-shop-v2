import assert from "node:assert/strict";
import test from "node:test";
import {
  aiProposalToStagingPatch,
  importRowToStagingPatch,
} from "./staging-sources.js";

test("maps supplier price row into commercial staging fields", () => {
  const patch = importRowToStagingPatch({
    title: "Крем 50 мл",
    brand: "Brand",
    barcode: "4870001",
    price: 6900,
    stock: 12,
  });

  assert.equal(patch.purchasePrice, 6900);
  assert.equal(patch.stock, 12);
  assert.equal(patch.title, "Крем 50 мл");
});

test("maps AI proposal into text-only patch by default", () => {
  const patch = aiProposalToStagingPatch({
    extracted: {
      title: "Новое название",
      brand: "Brand",
    },
    draft: {
      shortDescription: "Краткое описание",
      description: "Полное описание",
      application: "Применение",
      ingredients: "Состав",
    },
    imageCandidates: [
      { url: "https://example.com/product.jpg" },
    ],
  });

  assert.equal(patch.description, "Полное описание");
  assert.equal(patch.shortDescription, "Краткое описание");
  assert.equal(patch.title, undefined);
  assert.equal(patch.images, undefined);
});

test("AI image must be selected from proposal candidates", () => {
  assert.throws(
    () =>
      aiProposalToStagingPatch(
        {
          extracted: {},
          draft: {
            shortDescription: "",
            description: "Описание",
            application: "",
            ingredients: "",
          },
          imageCandidates: [{ url: "https://example.com/allowed.jpg" }],
        },
        { selectedImageUrl: "https://example.com/other.jpg" },
      ),
    /selected_image_not_in_proposal/,
  );
});
