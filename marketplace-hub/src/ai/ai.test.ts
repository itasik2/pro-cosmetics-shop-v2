import assert from "node:assert/strict";
import test from "node:test";
import { extractProductFromHtml } from "./extract.js";
import { scoreProductMatch } from "./match.js";
import { evaluateEnrichmentProposal } from "./policy.js";

const html = `<!doctype html>
<html>
<head>
  <link rel="canonical" href="https://brand.example/products/cream-a001" />
  <script type="application/ld+json">
  {
    "@context":"https://schema.org",
    "@type":"Product",
    "name":"Brand Hydrating Cream 50 ml",
    "sku":"A001",
    "brand":{"@type":"Brand","name":"Brand"},
    "description":"Увлажняющий крем Brand объёмом 50 мл для регулярного ухода. Поддерживает комфорт кожи и помогает уменьшить ощущение сухости.",
    "image":["https://brand.example/images/a001.jpg"],
    "offers":{"@type":"Offer","price":"12990","priceCurrency":"KZT"}
  }
  </script>
</head>
<body>
  <h1>Brand Hydrating Cream 50 ml</h1>
  <p>Способ применения: наносить на очищенную кожу утром и вечером.</p>
  <p>Состав: Aqua, Glycerin, Panthenol, Squalane, Allantoin.</p>
</body>
</html>`;

test("extracts structured product facts and image candidates", () => {
  const extracted = extractProductFromHtml({
    buffer: Buffer.from(html),
    finalUrl: "https://brand.example/products/cream-a001",
  });

  assert.equal(extracted.sku, "A001");
  assert.equal(extracted.brand, "Brand");
  assert.equal(extracted.price, 12990);
  assert.equal(extracted.currency, "KZT");
  assert.ok(extracted.images.includes("https://brand.example/images/a001.jpg"));
});

test("scores exact SKU brand and volume as high confidence", () => {
  const extracted = extractProductFromHtml({
    buffer: Buffer.from(html),
    finalUrl: "https://brand.example/products/cream-a001",
  });

  const result = scoreProductMatch(
    {
      sku: "A001",
      title: "Brand Hydrating Cream 50 ml",
      brand: "Brand",
      volumeValue: 50,
      volumeUnit: "ml",
    },
    extracted,
  );

  assert.ok(result.confidence >= 90);
  assert.equal(result.evidence.sku, "match");
  assert.equal(result.evidence.brand, "match");
  assert.equal(result.evidence.volume, "match");
});

test("only high-confidence official text can auto-apply", () => {
  const copy = {
    shortDescription:
      "Профессиональный увлажняющий крем для регулярного ухода за кожей с подтверждённым описанием действия и применения.",
    description:
      "Профессиональный крем для регулярного ухода за кожей. ".repeat(8),
    application: "Наносить на очищенную кожу утром и вечером.",
    ingredients: "Aqua, Glycerin, Panthenol.",
    warnings: [],
  };

  const safe = evaluateEnrichmentProposal({
    confidence: 96,
    sourceType: "OFFICIAL_SITE",
    sourceDomainAllowed: true,
    copy,
    warnings: [],
  });

  assert.equal(safe.decision, "AUTO_APPLY_TEXT");

  const external = evaluateEnrichmentProposal({
    confidence: 96,
    sourceType: "DISCOVERED_WEB",
    sourceDomainAllowed: true,
    copy,
    warnings: [],
  });

  assert.equal(external.decision, "REVIEW");
});
