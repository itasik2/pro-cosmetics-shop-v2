import { readFile, writeFile } from "node:fs/promises";

const path = "lib/enrichment/extractProduct.ts";
let content = await readFile(path, "utf8");

function replaceOnce(search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Не найден участок: ${label}`);
  }
  content = content.replace(search, replacement);
}

replaceOnce(
  "if (Number.isFinite(price) && price >= 0) {",
  "if (Number.isFinite(price) && price > 0) {",
  "нулевая цена JSON-LD",
);

replaceOnce(
  "return Number.isFinite(price) && price >= 0 ? price : null;",
  "return Number.isFinite(price) && price > 0 ? price : null;",
  "нулевая цена из текста",
);

replaceOnce(
  `function isLikelyProductImage(value: string) {\n  const normalized = value.toLocaleLowerCase(\"ru-RU\");\n  if (!normalized) return false;\n  if (/\\.svg(?:$|[?#])/i.test(normalized)) return false;\n\n  return !/(?:logo|icon|sprite|payment|favicon|avatar|badge|banner|button|widget|social|share|instagram|whatsapp|facebook|telegram|yandex|passport|login|signin|sign-in|auth|oauth|captcha)/i.test(\n    normalized,\n  );\n}`,
  `function isLikelyProductTitle(value: string | null) {\n  if (!value || value.length < 4) return false;\n  const normalized = normalizeSearchText(value);\n\n  return !/(?:войдите|создайте учетную запись|создать учетную запись|личный кабинет|авторизац|регистрац|забыли пароль|forgot password|sign in|log in|login|account)/i.test(\n    normalized,\n  );\n}\n\nfunction productHeading($: cheerio.CheerioAPI) {\n  const candidates = new Map<string, { text: string; score: number }>();\n\n  $(\"h1, .product-title, .product-info h1, #content h1, main h1\").each((_, element) => {\n    const text = cleanText($(element).text(), 500);\n    if (!isLikelyProductTitle(text)) return;\n\n    let score = Math.min(text.length, 120) / 120;\n    if ($(element).closest(\"#content, main, .product-info, .product-page\").length) score += 20;\n    if (/\\d+\\s*(?:мл|ml|г|гр|g|шт)\\b/iu.test(text)) score += 10;\n    if (/[А-ЯA-Z]{3,}/u.test(text)) score += 2;\n\n    const previous = candidates.get(text);\n    if (!previous || previous.score < score) candidates.set(text, { text, score });\n  });\n\n  return [...candidates.values()].sort((a, b) => b.score - a.score)[0]?.text ?? null;\n}\n\nfunction firstLikelyTitle(values: Array<string | null>) {\n  return values.find(isLikelyProductTitle) ?? null;\n}\n\nfunction isLikelyProductImage(value: string) {\n  const normalized = value.toLocaleLowerCase(\"ru-RU\");\n  if (!normalized) return false;\n  if (/\\.(?:svg|gif)(?:$|[?#])/i.test(normalized)) return false;\n\n  return !/(?:ajax[._-]?loader|loader|loading|spinner|progress|preload|logo|icon|sprite|payment|favicon|avatar|badge|banner|button|widget|social|share|instagram|whatsapp|facebook|telegram|yandex|passport|login|signin|sign-in|auth|oauth|captcha)/i.test(\n    normalized,\n  );\n}`,
  "фильтры заголовка и изображений",
);

replaceOnce(
  `  const title =\n    selectorTitle ||\n    cleanText(productNode?.name, 500) ||\n    cleanText($(\"h1\").first().text(), 500) ||\n    metaContent($, \"meta[property='og:title']\") ||\n    metaContent($, \"meta[name='twitter:title']\") ||\n    cleanText($(\"title\").first().text(), 500);`,
  `  const title = firstLikelyTitle([\n    selectorTitle,\n    cleanText(productNode?.name, 500),\n    productHeading($),\n    metaContent($, \"meta[property='og:title']\"),\n    metaContent($, \"meta[name='twitter:title']\"),\n    cleanText($(\"title\").first().text(), 500),\n  ]);`,
  "выбор товарного заголовка",
);

await writeFile(path, content);
