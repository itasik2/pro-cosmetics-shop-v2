import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ProductDescription from "../components/ProductDescription";
import { customerProductCopy, hasMissingProductData } from "../lib/productCopy";
import { extractProductFromHtml } from "../lib/enrichment/extractProduct";
import { fallbackDescription, generateProductDescription, hasUsefulProductDetails, needsRicherProductSource } from "../lib/enrichment/openaiResponses";
import { proposalText } from "../lib/enrichment/proposalText";
import { resolveProductSource } from "../lib/enrichment/resolveProductSource";
import { tildaProductEdition, tildaVariantPhoto } from "../lib/enrichment/tildaCatalog";

const missing = "Маска может занять место в уходе как дополнительное средство для лица, однако точные рекомендации по применению, включая способ разведения, время выдержки и частоту использования, не указаны.";
const benefit = "Маска увлажняет кожу и помогает сделать её более гладкой.";
const application = "Смешайте 30 г порошка со 100 мл воды температурой 18–20 °C; выдерживайте 15–20 минут.";
const product = { name: "Охлаждающая альгинатная маска с мятой", supplierSku: "SKY026", barcode: null,
  volumeValue: 30, volumeUnit: "g", brand: { name: "Skinosophy" }, supplier: null };
const pageUrl = "https://skinosophy.kz/catalog/ohlazhdayushaya-alginatnaya-maska-s-myatoy";
const accordion = (heading: string, value: string) => `<div class="t585__accordion"><div class="t585__title">${heading}</div><div class="t585__text">${value}</div></div>`;
const tilda = (fields: string) => Buffer.from(`<html><body><div class="t-rec"><div class="js-product js-store-product_single"><h1 class="js-product-name">Маска с жемчугом</h1></div></div><div class="t-rec" data-record-type="585">${fields}</div><footer>${accordion("Способ применения", "Чужая инструкция ежедневно")}</footer></body></html>`);

test("product accordions provide the actual protocol and INCI without borrowing missing fields from another record", () => {
  const extracted = extractProductFromHtml({ buffer: tilda(accordion("Описание", benefit) +
    accordion("Способ применения", application) + accordion("Активные компоненты", "Альгинат, экстракт василька") +
    accordion("Состав (INCI)", "Sodium alginate, Centaurea cyanus") + accordion("Меры предосторожности", "Только наружное применение")), finalUrl: pageUrl });
  assert.equal(extracted.description, benefit);
  assert.equal(extracted.application, application);
  assert.equal(extracted.ingredients, "Sodium alginate, Centaurea cyanus");
  assert.equal(extracted.benefits, null);
  assert.equal(hasUsefulProductDetails(extracted), true);
  const without = extractProductFromHtml({ buffer: tilda(accordion("Описание", benefit)), finalUrl: pageUrl });
  assert.equal(without.application, null);
  assert.equal(without.ingredients, null);
});

test("navigation, executable code and partial words cannot become product benefits", () => {
  const extracted = extractProductFromHtml({ finalUrl: pageUrl, buffer: Buffer.from(`<body>
    <nav>Эффект ботокса Другой бренд</nav><div class="catalog-menu">Эффект лифтинга Чужая линейка</div>
    <script>var text="ЭФФЕКТ: выдуманное свойство";</script><style>ЭФФЕКТ: ошибка</style>
    <h1>Маска с охлаждающим эффектом</h1><main><h2>Описание</h2><p>${benefit}</p><h2>Способ применения</h2><p>${application}</p><h2>Меры предосторожности</h2><p>Для наружного применения.</p></main>
    <footer>ЭФФЕКТ: посторонние данные</footer></body>`) });
  assert.equal(extracted.benefits, null);
  assert.equal(extracted.application, application);
  assert.equal(extracted.description, benefit);
  const inline = extractProductFromHtml({ finalUrl: pageUrl, buffer: Buffer.from(`<h1>Маска</h1><p>Описание:Маска даёт охлаждающий эффект и увлажняет кожу.</p><p>Способ применения:Нанести шпателем.</p>`) });
  assert.equal(inline.description, "Маска даёт охлаждающий эффект и увлажняет кожу.");
  assert.equal(inline.application, "Нанести шпателем.");
});

test("legacy editorial notes disappear from the editor and storefront while confirmed facts stay visible", () => {
  const description = `${benefit} ${missing}\n\nПодтверждённые сведения о конкретных свойствах в предоставленном источнике отсутствуют.`;
  assert.equal(hasMissingProductData(missing), true);
  assert.equal(customerProductCopy(description), benefit);
  assert.equal(hasMissingProductData("Формула не содержит отдушки и подходит для ухода за чувствительной кожей."), false);
  const text = proposalText({ title: product.name, shortDescription: description, description,
    application: "Способ применения не указан.", ingredients: "Aqua", product });
  assert.equal(text.description, benefit);
  assert.equal(text.application, null);
  const html = renderToStaticMarkup(<ProductDescription description={description} />);
  assert.ok(html.includes(benefit));
  assert.doesNotMatch(html, /не указаны|источнике|может занять место/);
});

test("an empty promotional source is rejected so discovery can continue to a source with actual facts", async () => {
  const poor = extractProductFromHtml({ buffer: Buffer.from('<meta name="description" content="Купить маску в нашем магазине. Заходите, вы останетесь довольны на 100 процентов."><h1>Маска</h1>'), finalUrl: "https://seller.example/mask" });
  assert.equal(hasUsefulProductDetails(poor), false);
  const source = await resolveProductSource({ initialUrl: "https://seller.example/mask", discover: true,
    excludedUrls: [], deadlineAt: Date.now() + 5000,
    stages: [{ stage: "official", find: async () => ({ found: true, url: pageUrl, confidence: 100, reason: "exact SKU" }) }],
    inspect: async (url) => { if (url.includes("seller.example") && !hasUsefulProductDetails(poor)) throw new Error("source_product_details_missing"); return url; },
  });
  assert.equal(source.value, pageUrl);
  assert.equal(source.searchResult.rejectedSources[0].reason, "source_product_details_missing");
});

test("AI output keeps confirmed product benefits and restores a source protocol instead of exposing editorial uncertainty", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  try {
    const inci = "Aqua, Glycerin, Sodium alginate, Calcium sulfate, Maris pearl powder, Centaurea cyanus, Tocopherol, Parfum.";
    const extracted = extractProductFromHtml({ buffer: tilda(accordion("Описание", benefit) + accordion("Способ применения", application) + accordion("Состав (INCI)", inci)), finalUrl: pageUrl });
    const result = await generateProductDescription({ product, extracted, sourceUrl: pageUrl }, async (_, options) => {
      const request = JSON.parse(String(options?.body));
      const facts = JSON.parse(request.input[1].content[0].text);
      assert.equal(facts.application, application);
      assert.equal(facts.sourceDescription, benefit);
      return new Response(JSON.stringify({ output_text: JSON.stringify({ shortDescription: `${benefit} ${missing}`,
        description: `${benefit}\n\n${missing}\n\nПолный перечень ингредиентов приведён в составе.\n\n${inci}`, application: "Способ применения не указан.", ingredients: inci, warnings: ["skin_type_not_confirmed"] }) }));
    });
    assert.equal(result.description, benefit);
    assert.equal(result.shortDescription, benefit);
    assert.equal(result.application, application);
    assert.equal(result.ingredients, inci);
    assert.ok(result.warnings.includes("editorial_notes_removed"));
    assert.ok(result.warnings.includes("skin_type_not_confirmed"));
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("placeholder fields require official discovery and produce missing-field warnings after fallback cleanup", () => {
  const extracted = { ...extractProductFromHtml({ buffer: tilda(accordion("Описание", benefit)), finalUrl: pageUrl }),
    application: "Способ применения не указан.", ingredients: "Состав не подтверждён." };
  assert.equal(hasUsefulProductDetails(extracted), true);
  assert.equal(needsRicherProductSource(extracted, true), true);
  assert.equal(needsRicherProductSource(extracted, false), false);
  assert.equal(needsRicherProductSource({ ...extracted, application }, true), false);
  const fallback = fallbackDescription(extracted);
  assert.equal(fallback.application, "");
  assert.equal(fallback.ingredients, "");
  assert.ok(fallback.warnings.includes("application_missing"));
  assert.ok(fallback.warnings.includes("ingredients_missing"));
});

test("a verified catalog edition can ground product text even when its own photo is absent", async () => {
  const api = JSON.parse(readFileSync("tests/fixtures/skinosophy-mint-api.json", "utf8"));
  api.products[0].editions[0].img = "";
  const input = { buffer: readFileSync("tests/fixtures/skinosophy-mint-product.html"), finalUrl: pageUrl,
    product, sku: "SKY026", officialDomains: ["skinosophy.kz"], deadlineAt: Date.now() + 5000 };
  const edition = await tildaProductEdition(input, async () => api);
  assert.equal(edition?.sku, "SKY026");
  assert.equal(edition?.label, "Саше — 30 г");
  assert.equal(edition?.image, null);
  assert.equal(await tildaVariantPhoto(input, async () => api), null);
});
