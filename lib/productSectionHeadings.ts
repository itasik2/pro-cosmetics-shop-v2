import type { SiteLocale } from "./i18n";

/** Recognize legacy Russian headings and their Kazakh/English equivalents. */
export const PRODUCT_SECTION_HEADINGS = [
  { ru: "Для какой кожи", kk: "Қандай теріге арналған", en: "Suitable skin types" },
  { ru: "Для каких задач", kk: "Қандай мәселелерге арналған", en: "What it targets" },
  { ru: "Преимущества", kk: "Артықшылықтары", en: "Benefits" },
  { ru: "Почему удобно", kk: "Қолдануға ыңғайлы тұстары", en: "Why it's convenient" },
  { ru: "Способ применения", kk: "Қолдану тәсілі", en: "How to use" },
  { ru: "Состав и активные компоненты", kk: "Құрамы және белсенді компоненттері", en: "Ingredients and active components" },
  { ru: "Важно", kk: "Маңызды", en: "Important" },
] as const;

export type ProductSectionHeading = (typeof PRODUCT_SECTION_HEADINGS)[number]["ru"];

const sectionByTitle = new Map<string, (typeof PRODUCT_SECTION_HEADINGS)[number]>(
  PRODUCT_SECTION_HEADINGS.flatMap((heading) => [
    [heading.ru, heading], [heading.kk, heading], [heading.en, heading],
  ] as const),
);

export const ALL_PRODUCT_SECTION_HEADINGS = [
  ...new Set(PRODUCT_SECTION_HEADINGS.flatMap((row) => [row.ru, row.kk, row.en])),
];

/**
 * A product description may arrive with Markdown headings, e.g.
 * "### Для какой кожи". Markdown markers are not part of the title.
 */
function cleanProductSectionTitle(value: string): string {
  return value.trim()
    .replace(/^#{1,6}[ \t]+/, "")
    .replace(/[ \t]+#{1,6}$/, "")
    .replace(/[:：]$/, "")
    .trim();
}

export function canonicalProductSectionHeading(text: string): ProductSectionHeading | null {
  const heading = sectionByTitle.get(cleanProductSectionTitle(text));
  return heading?.ru || null;
}

export function localizedProductSectionHeading(text: string, locale: SiteLocale): string | null {
  const heading = sectionByTitle.get(cleanProductSectionTitle(text));
  return heading?.[locale] || null;
}

/** Remove Markdown markers from known headings only, leaving product prose unchanged. */
export function stripProductSectionMarkdown(text: string): string {
  if (!text.includes("#")) return text;
  return text.replace(/(^|\n)([ \t]*)#{1,6}[ \t]+([^\r\n]+)(?=\r?\n|$)/g,
    (line, prefix: string, indent: string, title: string) => {
      const canonical = canonicalProductSectionHeading(title);
      return canonical ? prefix + indent + title.replace(/[ \t]+#{1,6}$/, "").trim() : line;
    });
}

/**
 * Localize standalone section headings without touching INCI, active
 * ingredient names, doses, directions, brand names or other body text.
 * Supports both old Russian headers and already translated headers.
 */
export function localizeProductSectionHeadings(text: string, locale: SiteLocale): string {
  if (locale === "ru" || !text) return text;
  return text.replace(/(^|\n)([ \t]*)([^\r\n]+)(?=\r?\n|$)/g, (line, prefix: string, padding: string, value: string) => {
    const trimmed = value.trim();
    const title = localizedProductSectionHeading(trimmed, locale);
    if (!title) return line;
    const colon = /[:：]$/.test(trimmed) ? ":" : "";
    return prefix + padding + title + colon;
  });
}
