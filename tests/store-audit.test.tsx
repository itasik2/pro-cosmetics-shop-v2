import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CARE_OPTIONS, CATEGORY_OPTIONS, productMatchesCategory, productMatchesCare, productMatchesBudget, publicProductCategory, parseBudget } from "../lib/catalogFilters";
import { configuredDeliveryPrice, getStorePolicy } from "../lib/storePolicy";
import { publicShortDescription } from "../lib/productCopy";
import { verifiedProductCopy } from "../lib/verifiedProductInstructions";
import { evaluateCatalogAutopilotProposal } from "../lib/enrichment/catalogAutopilotPolicy";
import ArticleContent from "../components/ArticleContent";
import ProductDescription from "../components/ProductDescription";

test("uncategorized cream gets a useful label without changing a stored skin category", () => {
  assert.equal(publicProductCategory({ name: "Rejusome Exo Boost Cream", category: "Без категории" }), "Кремы");
  assert.equal(publicProductCategory({ name: "Крем", category: "Чувствительная кожа" }), "Чувствительная кожа");
});

test("a toner mentioning cream in its description does not enter creams", () => {
  const toner = { name: "My Ato Toner Mousse", category: "Без категории", shortDescription: "Использовать перед кремом" };
  assert.equal(productMatchesCategory(toner, CATEGORY_OPTIONS.find((v) => v.slug === "kremy")!), false);
  assert.equal(productMatchesCategory(toner, CATEGORY_OPTIONS.find((v) => v.slug === "toniki")!), true);
  assert.equal(productMatchesCategory({ name: "Repair Mask", category: "Без категории" }, CATEGORY_OPTIONS.find((v) => v.slug === "maski")!), true);
});

test("care filters do not claim a need when the catalog does not state it", () => {
  assert.ok(CARE_OPTIONS.length > 0);
  assert.equal(productMatchesCare({ name: "My Ato Toner", category: "Без категории" }, "sensitive"), false);
  assert.equal(productMatchesCare({ name: "Крем", category: "Чувствительная кожа" }, "sensitive"), true);
});

test("budget uses available variants rather than a sold out cheap base price", () => {
  const product = { price: 1000, stock: 0, variants: [{ stock: 0, price: 1000 }, { stock: 2, price: 20000 }] };
  assert.equal(productMatchesBudget(product, 5000), false);
  assert.equal(productMatchesBudget(product, 20000), true);
  assert.equal(parseBudget("-1"), null);
  assert.equal(parseBudget("10000"), 10000);
});

test("unknown delivery is distinct from explicitly free delivery", () => {
  assert.equal(configuredDeliveryPrice(""), null);
  assert.equal(configuredDeliveryPrice("bad"), null);
  assert.equal(configuredDeliveryPrice("-300"), null);
  assert.equal(configuredDeliveryPrice("1.5"), null);
  assert.equal(configuredDeliveryPrice("0"), 0);
  assert.equal(configuredDeliveryPrice("1500"), 1500);
  assert.equal(getStorePolicy().deliveryPrice, null);
});

test("editorial notes are removed from sales copy and missing use instructions stay explicit", () => {
  assert.equal(publicShortDescription("Мист объёмом 150 мл. Подтверждённые задачи и преимущества средства не указаны."), "Мист объёмом 150 мл.");
  const html = renderToStaticMarkup(<ProductDescription description={"Способ применения\nПодробная схема применения в доступных данных не указана."} />);
  assert.ok(html.includes("Уточните способ применения перед покупкой"));
  assert.ok(!html.includes("в доступных данных"));
});

test("verified instructions are restricted to the matching incomplete Angiopharm product", () => {
  const product = { name: "Азелаиновый крем для чувствительной кожи 10 %", brand: { name: "Angiopharm" }, description: "Подробная схема применения в доступных данных не указана." };
  assert.ok(verifiedProductCopy(product)?.description.includes("SPF 30/50"));
  assert.equal(verifiedProductCopy({ ...product, brand: { name: "Other" } }), null);
  assert.equal(verifiedProductCopy({ ...product, name: "Крем для чувствительной кожи" }), null);
  assert.equal(verifiedProductCopy({ ...product, description: "Моя полная ручная инструкция." }), null);
});

test("autopilot does not treat an unavailable application as a valid instruction", () => {
  const result = evaluateCatalogAutopilotProposal({ confidence: 99, sourceType: "OFFICIAL_SITE", sourceDomain: "example.com", sourceUrl: "https://example.com/product", description: "Для какой кожи\nЧувствительная кожа\n" + "Описание. ".repeat(60) + "\n• один\n• два\n• три", shortDescription: "Описание средства для чувствительной кожи с подробной информацией о компонентах и назначении.", application: "Подробная схема применения в доступных данных не указана." }, { enabled: true, minConfidence: 90 });
  assert.equal(result.decision, "REVIEW");
  assert.ok(result.reasons.includes("incomplete_product_information"));
});

test("blog renders real lists and tables and does not execute source HTML", () => {
  const html = renderToStaticMarkup(<ArticleContent content={"## Уход\n\n- Очищение\n- Увлажнение\n\n| Этап | Средство |\n| --- | --- |\n| Утро | Крем |\n\n[опасная ссылка](javascript:alert(1))\n\n<script>alert(1)</script>"} />);
  assert.ok(html.includes("<ul"));
  assert.ok(html.includes("<table"));
  assert.ok(html.includes("<th"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes('href="javascript:'));
});
