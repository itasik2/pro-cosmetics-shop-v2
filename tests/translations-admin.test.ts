import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentSourceHash } from "../lib/localizedContent";
import {
  ALL_PRODUCT_SECTION_HEADINGS,
  canonicalProductSectionHeading,
  localizeProductSectionHeadings,
  localizedProductSectionHeading,
  stripProductSectionMarkdown,
} from "../lib/productSectionHeadings";
import { translationModelCandidates, translationModelUnavailable } from "../lib/translationModels";

test("source fingerprint detects meaningful changes to the Russian copy", () => {
  const first = contentSourceHash("Маска Skinosophy", "Увлажняющая маска", "Для какой кожи\nЧувствительная.");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, contentSourceHash("Маска Skinosophy", "Увлажняющая маска", "Для какой кожи\nЧувствительная."));
  assert.notEqual(first, contentSourceHash("Маска Skinosophy", "Увлажняющая маска", "Для какой кожи\nСухая."));
});

test("translation administration never bypasses admin guard or silently publishes AI", () => {
  const route = readFileSync(join(process.cwd(), "app/api/admin/translations/route.ts"), "utf8");
  const ui = readFileSync(join(process.cwd(), "app/admin/(private)/translations/AdminTranslationsClient.tsx"), "utf8");
  assert.match(route, /await requireAdmin\(\)/);
  assert.match(route, /source\.hash !== sourceHash/);
  assert.match(route, /status === "PUBLISHED"/);
  assert.match(ui, /Подготовить черновик ИИ/);
  assert.match(ui, /Опубликовать перевод/);
});

test("bulk translation stops on the first upstream error and shows provider code", () => {
  const route = readFileSync(join(process.cwd(), "app/api/admin/translations/route.ts"), "utf8");
  const ui = readFileSync(join(process.cwd(), "app/admin/(private)/translations/AdminTranslationsClient.tsx"), "utf8");
  assert.match(route, /translation_provider_rejected/);
  assert.match(route, /providerStatus: response.status/);
  assert.match(route, /translation_connection_failed/);
  assert.match(ui, /readableError/);
  assert.match(ui, /const ok = await processOne\(pending\[0\]\)/);
  assert.match(ui, /if \(!ok\) stopBulk.current = true/);
  assert.match(ui, /Дальнейшие запросы остановлены/);
});

test("translation models prefer configured enrichment model over unavailable legacy default", () => {
  assert.deepEqual(translationModelCandidates("", "gpt-5.6-luna"), ["gpt-5.6-luna", "gpt-4o-mini"]);
  assert.deepEqual(translationModelCandidates("gpt-custom", "gpt-5.6-luna"), ["gpt-custom", "gpt-5.6-luna", "gpt-4o-mini"]);
  assert.deepEqual(translationModelCandidates("gpt-4o-mini", "gpt-4o-mini"), ["gpt-4o-mini", "gpt-5.6-luna"]);
  assert.equal(translationModelUnavailable(403, "model_not_found"), true);
  assert.equal(translationModelUnavailable(401, "invalid_api_key"), false);
  assert.equal(translationModelUnavailable(429, "insufficient_quota"), false);
  assert.equal(translationModelUnavailable(403, "permission_denied"), false);
  assert.equal(translationModelUnavailable(502, "model_not_found"), false);
});

test("translation generation retries only on explicitly unavailable model", () => {
  const route = readFileSync(join(process.cwd(), "app/api/admin/translations/route.ts"), "utf8");
  assert.match(route, /getScopedEnv\("OPENAI_ENRICHMENT_MODEL"\)/);
  assert.match(route, /translationModelUnavailable\(response.status, errorCode\)/);
  assert.match(route, /if \(!retry\) return upstreamTranslationFailure\(response\)/);
  assert.doesNotMatch(route, /getScopedEnv\("OPENAI_TRANSLATION_MODEL"\) \|\| "gpt-4\.1-mini"/);
});

test("Kazakh and English product section headings replace legacy Russian headers", () => {
  const original = [
    "JeuDerm AcnoCell — легкий гель.",
    "",
    "Способ применения",
    "Гельді аз мөлшердегі сумен көбіктендіріңіз.",
    "",
    "Состав и активные компоненты",
    "Салициловая кислота, Sodium Hyaluronate, Glycerin.",
  ].join("\n");
  const kazakh = localizeProductSectionHeadings(original, "kk");
  assert.match(kazakh, /\nҚолдану тәсілі\n/);
  assert.match(kazakh, /\nҚұрамы және белсенді компоненттері\n/);
  assert.doesNotMatch(kazakh, /\nСпособ применения\n|\nСостав и активные компоненты\n/);
  assert.ok(kazakh.includes("Гельді аз мөлшердегі сумен көбіктендіріңіз."));
  assert.ok(kazakh.includes("Салициловая кислота, Sodium Hyaluronate, Glycerin."));
  const english = localizeProductSectionHeadings(original, "en");
  assert.match(english, /\nHow to use\n/);
  assert.match(english, /\nIngredients and active components\n/);
  assert.equal(localizeProductSectionHeadings(kazakh, "kk"), kazakh);
  assert.equal(localizeProductSectionHeadings(english, "en"), english);
  assert.equal(localizeProductSectionHeadings(original, "ru"), original);
});

test("only standalone section headings change, not prose or ingredient lists", () => {
  const original = [
    "Способ применения: нанесите гель.",
    "Состав и активные компоненты включают масла и экстракты.",
    "Способ применения",
    "Важно: Sodium Hyaluronate, 20 мл и SPF 50+ не изменяются.",
    "Важно",
    "Не наносить на повреждённую кожу.",
  ].join("\n");
  const out = localizeProductSectionHeadings(original, "en");
  assert.ok(out.includes("Способ применения: нанесите гель."));
  assert.ok(out.includes("Состав и активные компоненты включают масла"));
  assert.ok(out.includes("\nHow to use\n"));
  assert.ok(out.includes("\nImportant\n"));
  assert.ok(out.includes("Важно: Sodium Hyaluronate, 20 мл и SPF 50+ не изменяются."));
  assert.equal(canonicalProductSectionHeading("Қолдану тәсілі"), "Способ применения");
  assert.equal(canonicalProductSectionHeading("Ingredients and active components"), "Состав и активные компоненты");
  assert.equal(localizedProductSectionHeading("Способ применения", "kk"), "Қолдану тәсілі");
  assert.ok(ALL_PRODUCT_SECTION_HEADINGS.includes("How to use"));
});

test("translation admin normalizes legacy drafts without direct production SQL updates", () => {
  const route = readFileSync(join(process.cwd(), "app/api/admin/translations/route.ts"), "utf8");
  assert.match(route, /localizeProductSectionHeadings\(translation\.body, locale\)/);
  assert.match(route, /localizeProductSectionHeadings\(rawBody, locale\)/);
  assert.match(route, /localizeProductSectionHeadings\(answer\.body, locale\)/);
  assert.doesNotMatch(route, /retain Russian section header markers/);
});

test("markdown heading hashes are removed from legacy Kazakh and English translations", () => {
  const source = [
    "Тауар сипаттамасы.",
    "",
    "### Для какой кожи",
    "Майлы теріге жарамды.",
    "",
    "### Преимущества",
    "• Күнделікті тазарту.",
    "",
    "### Способ применения",
    "Теріні сумен шайыңыз.",
    "",
    "### Состав и активные компоненты",
    "Aqua, Glycerin.",
  ].join("\n");
  const kazakh = localizeProductSectionHeadings(source, "kk");
  assert.match(kazakh, /\nҚандай теріге арналған\n/);
  assert.match(kazakh, /\nАртықшылықтары\n/);
  assert.match(kazakh, /\nҚолдану тәсілі\n/);
  assert.match(kazakh, /\nҚұрамы және белсенді компоненттері\n/);
  assert.doesNotMatch(kazakh, /###|Для какой кожи|Способ применения/);
  assert.ok(kazakh.includes("Aqua, Glycerin."));
  const english = localizeProductSectionHeadings(source, "en");
  assert.match(english, /\nSuitable skin types\n/);
  assert.match(english, /\nBenefits\n/);
  assert.match(english, /\nHow to use\n/);
  assert.doesNotMatch(english, /###/);
  assert.equal(canonicalProductSectionHeading("### Преимущества"), "Преимущества");
  assert.equal(localizedProductSectionHeading("### Для какой кожи", "kk"), "Қандай теріге арналған");
  assert.equal(localizeProductSectionHeadings(kazakh, "kk"), kazakh);
});

test("markdown cleanup only strips known title lines, not hashtags or embedded hashes", () => {
  const source = "Используйте SPF 50+\n\n### Преимущества\nПольза для кожи\n\n#SKINOSOPHY акция\n### Непроверенный раздел\nОписание с #хэштегом";
  const clean = stripProductSectionMarkdown(source);
  assert.match(clean, /\nПреимущества\n/);
  assert.ok(clean.includes("#SKINOSOPHY акция"));
  assert.ok(clean.includes("### Непроверенный раздел"));
  assert.ok(clean.includes("#хэштегом"));
  assert.equal(stripProductSectionMarkdown(clean), clean);
});

test("translation availability badges distinguish published, draft, stale and missing", async () => {
  const { translationAvailability } = await import("../lib/translationAvailability");
  const sourceHash = "abc";
  assert.equal(translationAvailability(sourceHash, undefined), "MISSING");
  assert.equal(translationAvailability(sourceHash, { sourceHash, status: "REVIEW" }), "REVIEW");
  assert.equal(translationAvailability(sourceHash, { sourceHash, status: "PUBLISHED" }), "PUBLISHED");
  assert.equal(translationAvailability(sourceHash, { sourceHash: "old", status: "PUBLISHED" }), "STALE");
  assert.equal(translationAvailability(sourceHash, { sourceHash: "old", status: "REVIEW" }), "STALE");
});

test("translation list fetches both locales and shows badges without falsely marking drafts published", () => {
  const route = readFileSync(join(process.cwd(), "app/api/admin/translations/route.ts"), "utf8");
  const ui = readFileSync(join(process.cwd(), "app/admin/(private)/translations/AdminTranslationsClient.tsx"), "utf8");
  assert.match(route, /locale: \{ in: \["kk", "en"\] \}/);
  assert.match(route, /languages = \{/);
  assert.match(route, /translationAvailability\(hash,/);
  assert.match(ui, /<LanguageBadges languages=\{value\.languages\}/);
  assert.match(ui, /<LanguageBadges languages=\{item\.languages\}/);
  assert.match(ui, /PUBLISHED: "✓", REVIEW: "•", STALE: "!", MISSING: "−"/);
});
