export type CategoryOption = { slug: string; label: string; searchTerms: string[] };

export const CATEGORY_OPTIONS: CategoryOption[] = [
  { slug: "kremy", label: "Кремы", searchTerms: ["крем", "cream", "creme", "флюид"] },
  { slug: "syvorotki", label: "Сыворотки", searchTerms: ["сыворот", "serum", "концентрат", "ампул", "ampoule"] },
  { slug: "toniki", label: "Тоники", searchTerms: ["тоник", "тонер", "tonic", "toner", "лосьон"] },
  { slug: "ochishchenie", label: "Очищение", searchTerms: ["очища", "умыван", "cleanser", "clean gel", "universal clean", "мицелляр", "гидрофильн"] },
  { slug: "maski", label: "Маски", searchTerms: ["маск", "mask"] },
  { slug: "pilingi", label: "Пилинги и эксфолианты", searchTerms: ["пилинг", "peel", "эксфоли", "exfol", "гоммаж", "multi acid pad", "энзимная"] },
  { slug: "emulsii", label: "Эмульсии", searchTerms: ["эмульс", "emulsion", "гидрант", "hydratant"] },
  { slug: "guby", label: "Уход за губами", searchTerms: ["губ", "lip balm", "lip gloss"] },
];

export const CARE_OPTIONS = [
  { slug: "sensitive", label: "Чувствительная кожа", terms: ["чувствительн", "sensitive"] },
  { slug: "hydration", label: "Увлажнение и сухость", terms: ["увлаж", "сухой", "сухая", "сухую", "сухость", "hydra", "moist"] },
  { slug: "problem", label: "Жирная и проблемная кожа", terms: ["проблемн", "жирной", "жирная", "комбинирован", "acnocell", "акне"] },
  { slug: "age", label: "Возрастной уход", terms: ["возрастн", "зрелой", "зрелая", "морщин", "омолаж", "лифтинг", "reform age", "reforme age", "lift"] },
] as const;

type CatalogProduct = { name: string; category: string; shortDescription?: string | null; productLineName?: string | null };

export function normalizeCatalogText(value: unknown) {
  return String(value || "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ").replace(/\s+/g, " ").trim();
}

const containsTerm = (text: string, terms: readonly string[]) =>
  terms.some((term) => text.includes(normalizeCatalogText(term)));

export function productMatchesCategory(product: CatalogProduct, category: CategoryOption | null) {
  if (!category) return true;
  const primary = normalizeCatalogText([product.name, product.category, product.productLineName].filter(Boolean).join(" "));
  if (containsTerm(primary, category.searchTerms)) return true;
  if (CATEGORY_OPTIONS.some((other) => other.slug !== category.slug && containsTerm(primary, other.searchTerms))) return false;
  return containsTerm(normalizeCatalogText(product.shortDescription), category.searchTerms);
}

export function publicProductCategory(product: Pick<CatalogProduct, "name" | "category">) {
  const stored = product.category.trim();
  if (stored && !/^(без категории|uncategorized|не указана|другое)$/i.test(stored)) return stored;
  const name = normalizeCatalogText(product.name);
  return CATEGORY_OPTIONS.find((option) => containsTerm(name, option.searchTerms))?.label || "Уход за кожей";
}

export function productMatchesCare(product: CatalogProduct, care: string) {
  const option = CARE_OPTIONS.find((item) => item.slug === care);
  if (!option) return true;
  return containsTerm(normalizeCatalogText([product.name, product.category, product.shortDescription, product.productLineName].filter(Boolean).join(" ")), option.terms);
}

export function parseBudget(value: string) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 1_000_000 ? number : null;
}

export function productMatchesBudget(product: { price: number; stock: number; variants?: unknown }, maxPrice: number | null) {
  if (maxPrice === null) return true;
  if (Array.isArray(product.variants) && product.variants.length) {
    return product.variants.some((v) => v && typeof v === "object" && Number(v.stock) > 0 && Number(v.price) > 0 && Number(v.price) <= maxPrice);
  }
  return product.stock > 0 && product.price > 0 && product.price <= maxPrice;
}
