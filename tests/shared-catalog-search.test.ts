import assert from "node:assert/strict";
import test from "node:test";
import { sharedSearchInput, searchSharedCatalogProduct } from "../lib/enrichment/sharedCatalogSearch";
import { scoreProductMatch } from "../lib/enrichment/matchProduct";

test("shared search only accepts product identity, never commerce fields", () => {
  const result = sharedSearchInput.parse({
    product: { sku: "JD-123", title: "Cleanser 250 мл", brand: "JeuDerm", purchasePrice: 13100, price: 19000 },
    allowExternalSearch: false, organizationId: "another-tenant",
  });
  assert.equal(result.product.sku, "JD-123");
  assert.deepEqual(Object.keys(result.product).sort(), ["brand", "sku", "title"]);
  assert.equal("organizationId" in result, false);
});

test("automatic network search requires the server AI credential", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(searchSharedCatalogProduct({
      product: { sku: "JD-123", title: "Cleanser 250 мл" },
    }), /openai_not_configured/);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("Cyrillic volume protects against the wrong photo variant", () => {
  const match = scoreProductMatch({
    name: "Cleanser 250 мл", supplierSku: null, barcode: null,
    brand: { name: "JeuDerm" }, supplier: null, category: null,
    productLineName: null, volumeValue: 250, volumeUnit: "мл",
  }, {
    title: "JeuDerm Cleanser 100 мл", description: "Очищающее средство", sku: null,
    brand: "JeuDerm", images: [], skinType: null, benefits: null,
    canonicalUrl: null, ingredients: null, application: null,
    price: null, currency: null, rawJsonLd: null,
  });
  assert.equal(match.evidence.volume, "mismatch");
});
