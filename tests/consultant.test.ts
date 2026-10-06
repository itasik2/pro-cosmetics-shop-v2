import assert from "node:assert/strict";
import test from "node:test";
import { parseConsultantCriteria, rankConsultantProducts, recommendationFromProduct, validateConsultantReply, consultantDescription, needsConsultantClarification, respectsIngredientExclusions, needsSpecialist } from "../lib/consultantCatalog";
import type { ConsultantProduct } from "../lib/consultantCatalog";
import { askCatalogAi, ConsultantProviderError } from "../lib/consultantAi";

const base: ConsultantProduct = { id: "cream", slug: "cream", name: "Крем для чувствительной кожи", image: "/cream.jpg", category: "Без категории", description: "Увлажняет кожу. Способ применения\nНаносите по инструкции.", shortDescription: "Увлажняющий крем для чувствительной кожи", productLineName: null, price: 1000, stock: 0, variants: [{ id: "sample", label: "7 мл", price: 4500, stock: 2 }, { id: "full", label: "50 мл", price: 15000, stock: 5 }], brand: { name: "Angiopharm" } };

test("follow-up changes budget and keeps skin/type, including thousands and reset", () => {
  const criteria = parseConsultantCriteria(["Чувствительная кожа, нужен крем до 10 000 ₸", "Давай до 5 тыс."]);
  assert.equal(criteria.maxPrice, 5000); assert.equal(criteria.care, "sensitive"); assert.equal(criteria.category, "kremy");
  assert.equal(parseConsultantCriteria(["Бюджет до 10000", "Без ограничения бюджета"]).maxPrice, null);
  assert.equal(parseConsultantCriteria(["Увлажнение и сыворотка до 7,5 тыс"]).maxPrice, 7500);
});

test("retrieval excludes wrong need, unavailable variants and outside budget", () => {
  const criteria = parseConsultantCriteria(["Крем для чувствительной кожи до 5000"]);
  const products = [base, { ...base, id: "expensive", variants: [{ id: "a", label: "50 мл", price: 20000, stock: 2 }] }, { ...base, id: "empty", variants: [{ id: "a", label: "7 мл", price: 1000, stock: 0 }] }, { ...base, id: "toner", name: "Тоник", category: "Тоники", shortDescription: "Наносите перед кремом" }];
  assert.deepEqual(rankConsultantProducts(products, criteria).map((row) => row.product.id), ["cream"]);
  const card = recommendationFromProduct(base, criteria, "Увлажнение");
  assert.equal(card?.price, 4500); assert.equal(card?.variantId, "sample"); assert.equal(card?.volume, "7 мл"); assert.equal(card?.stock, 2);
});

test("generic selection asks a question instead of choosing newest products", () => {
  const criteria = parseConsultantCriteria(["Подбери мне уход"]);
  assert.ok(needsConsultantClarification(criteria, ""));
  assert.ok(needsConsultantClarification(parseConsultantCriteria(["Помоги выбрать уход"]), ""));
  assert.ok(needsConsultantClarification(parseConsultantCriteria(["Помоги с выбором"]), ""));
  assert.deepEqual(rankConsultantProducts([base], { ...criteria, query: "Привет" }), []);
});

test("medical restrictions persist across a follow-up and cosmetic sensitivity remains supported", () => {
  assert.ok(needsSpecialist(["Я беременна", "Подбери крем"]));
  assert.ok(needsSpecialist(["Как лечить псориаз?"]));
  assert.equal(needsSpecialist(["Крем для чувствительной кожи до 5000"]), false);
});

test("sold out target may be discussed but cannot be offered for purchase", () => {
  const empty = { ...base, variants: [], stock: 0 };
  const criteria = parseConsultantCriteria(["Как применять?"]);
  assert.equal(rankConsultantProducts([empty], criteria, empty.id).length, 1);
  assert.equal(recommendationFromProduct(empty, criteria, ""), null);
});

test("a requested full size cannot be replaced by a cheap sample", () => {
  const criteria = parseConsultantCriteria(["Крем для чувствительной кожи 50 мл до 5000"]);
  assert.deepEqual(criteria.volume, { value: 50, unit: "ml" });
  assert.equal(rankConsultantProducts([base], criteria).length, 0);
  assert.equal(recommendationFromProduct(base, criteria, ""), null);
  const affordable = parseConsultantCriteria(["Крем 50 мл до 20000"]);
  assert.equal(recommendationFromProduct(base, affordable, "")?.variantId, "full");
});

test("model IDs are validated and prices come from server, not generated JSON", () => {
  const criteria = parseConsultantCriteria(["Крем до 5000"]);
  const reply = validateConsultantReply({ answer: "Вот вариант", recommendations: [{ productId: "invented", reason: "" }, { productId: "cream", reason: "Увлажнение", price: 1 }, { productId: "cream", reason: "Дубликат" }] }, [base], criteria);
  assert.equal(reply.recommendations.length, 1); assert.equal(reply.recommendations[0].price, 4500);
  assert.throws(() => validateConsultantReply({ recommendations: [] }, [base], criteria));
});

test("copy removes missing data and unsafe source links", () => {
  const copy = consultantDescription({ ...base, description: "Увлажняет.\nПодтвержденные задачи и преимущества средства не указаны.", enrichmentProposals: [{ ingredients: "Aqua", sourceUrl: "javascript:alert(1)" }] });
  assert.equal(copy.sourceUrl, null); assert.ok(!copy.description.includes("не указаны"));
});

test("ingredient exclusions need confirmed ingredients rather than guessed absence", () => {
  assert.equal(respectsIngredientExclusions(base, "Крем без отдушки"), false);
  const verified = { ...base, enrichmentProposals: [{ ingredients: "Aqua, Glycerin, Parfum", sourceUrl: "https://manufacturer.test/product" }] };
  assert.equal(respectsIngredientExclusions(verified, "Крем без отдушки"), false);
  assert.equal(respectsIngredientExclusions({ ...verified, enrichmentProposals: [{ ...verified.enrichmentProposals[0], ingredients: "Aqua, Glycerin" }] }, "Крем без отдушки"), true);
});

test("provider gets constrained schema and server catalog, errors and truncation fail cleanly", async () => {
  const criteria = parseConsultantCriteria(["Крем для чувствительной кожи до 5000"]);
  const input = { apiKey: "test-not-a-real-key", model: "gpt-4o-mini", query: criteria.query, history: [], products: [base], criteria, deliveryTerms: "Уточните до оплаты", deliveryPrice: null, returnsTerms: "" };
  const fake: typeof fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.store, false); assert.equal(body.max_completion_tokens, 1000);
    assert.deepEqual(body.response_format.json_schema.schema.properties.recommendations.items.properties.productId.enum, ["cream"]);
    const context = JSON.parse(body.messages.at(-1).content); assert.equal(context.catalog[0].offer.price, 4500);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "Подходит по назначению", recommendations: [{ productId: "cream", reason: "Увлажнение" }] }) } }] });
  };
  assert.equal((await askCatalogAi(input, fake)).recommendations[0].variantId, "sample");
  await assert.rejects(askCatalogAi(input, async () => new Response("", { status: 429 })), /ai_http_429/);
  await assert.rejects(askCatalogAi(input, async () => Response.json({ error: { code: "unsupported_parameter", param: "max_completion_tokens", message: "must not expose request or key" } }, { status: 400 })), (error: unknown) => error instanceof ConsultantProviderError && error.parameter === "max_completion_tokens" && !error.message.includes("key"));
  await assert.rejects(askCatalogAi(input, async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] })), /ai_incomplete_reply/);
});
