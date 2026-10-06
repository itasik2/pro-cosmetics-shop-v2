import { CATEGORY_OPTIONS, CARE_OPTIONS, normalizeCatalogText, productMatchesCategory, productMatchesCare, publicProductCategory } from "./catalogFilters";
import { publicShortDescription, hasMissingProductData } from "./productCopy";
import { verifiedProductCopy } from "./verifiedProductInstructions";

export type ConsultantProduct = {
  id: string; slug: string; name: string; image: string; category: string;
  description: string; shortDescription: string | null; productLineName: string | null;
  price: number; stock: number; variants: unknown; brand: { name: string } | null;
  enrichmentProposals?: Array<{ ingredients: string | null; sourceUrl: string | null }>;
  volumeValue?: number | null; volumeUnit?: string | null;
};
export type ConsultantRecommendation = {
  id: string; slug: string; name: string; image: string; brand: string; category: string;
  price: number; stock: number; variantId: string | null; volume: string;
  summary: string; reason: string; sourceUrl: string | null;
};
export type ConsultantCriteria = { care: string; category: string; maxPrice: number | null; brand: string; query: string; volume?: { value: number; unit: string } | null };

function volumeFromText(text: string) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|грамм(?:а|ов)?|гр|г|g)\b/iu)
    ?? text.match(/(\d+(?:[.,]\d+)?)\s*(мл|грамм(?:а|ов)?|гр|г)(?=$|[\s.,])/iu);
  return match ? { value: Number(match[1].replace(",", ".")), unit: /^(мл|ml)$/iu.test(match[2]) ? "ml" : "g" } : null;
}

const CARE_SYNONYMS: Record<string, RegExp> = {
  sensitive: /чувствительн|sensitive|реактивн/iu,
  hydration: /увлаж|сух(?:ая|ой|ую|ость)|обезвож|стягива|шелуш|moist|hydra/iu,
  problem: /жирн|проблемн|комбинирован|акне|высыпан|прыщ|acnocell/iu,
  age: /возрастн|морщин|лифтинг|антивозраст|зрел(?:ая|ой)|омолаж/iu,
};
const CATEGORY_SYNONYMS: Record<string, RegExp> = {
  ochishchenie: /очища|умыва|смыть макияж|гидрофильн|cleanser/iu,
  kremy: /крем|cream|флюид/iu, syvorotki: /сыворот|serum|ампул/iu,
  toniki: /тоник|тонер|toner|лосьон/iu, maski: /маск|mask/iu,
  pilingi: /пилинг|эксфоли|peel|гоммаж/iu, emulsii: /эмульс|emulsion|гидрант/iu,
  guby: /губ|lip balm/iu,
};

export function parseConsultantCriteria(messages: string[]): ConsultantCriteria {
  let care = "", category = "", brand = "", maxPrice: number | null = null;
  let volume: ConsultantCriteria["volume"] = null;
  for (const message of messages) {
    if (/все задачи|любой тип кожи/iu.test(message)) care = "";
    for (const option of CARE_OPTIONS) if (CARE_SYNONYMS[option.slug].test(message)) { care = option.slug; break; }
    if (/любое средство|все средства/iu.test(message)) category = "";
    for (const option of CATEGORY_OPTIONS) if (CATEGORY_SYNONYMS[option.slug].test(message)) { category = option.slug; break; }
    if (/любой бренд|все бренды/iu.test(message)) brand = "";
    if (/angiopharm|ангиофарм/iu.test(message)) brand = "angiopharm";
    if (/jeuderm|jeu\s*derm|ж[её]дерм/iu.test(message)) brand = "jeuderm";
    if (/без ограничени|бюджет не важен/iu.test(message)) maxPrice = null;
    if (/любой объ[её]м|объ[её]м не важен/iu.test(message)) volume = null;
    const requestedVolume = volumeFromText(message);
    if (requestedVolume) volume = requestedVolume;
    const budget = message.match(/(?:до|не более|бюджет(?:ом)?\s*(?:до|:)?|подешевле\s*(?:до)?)\s*(\d[\d \u00a0]*(?:[.,]\d+)?)\s*(тыс(?:яч)?\.?|к\b|k\b)?/iu);
    if (budget) {
      const value = Number(budget[1].replace(/[ \u00a0]/g, "").replace(",", ".")) * (budget[2] ? 1000 : 1);
      if (Number.isSafeInteger(value) && value > 0 && value <= 1_000_000) maxPrice = value;
    }
  }
  return { care, category, brand, maxPrice, volume, query: messages.slice(-3).join(" ") };
}

function availableOffer(product: ConsultantProduct, maxPrice: number | null, requestedVolume?: ConsultantCriteria["volume"]) {
  if (Array.isArray(product.variants) && product.variants.length) {
    return product.variants.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      const price = Number(row.price), stock = Number(row.stock);
      const volume = volumeFromText(String(row.label || ""));
      if (typeof row.id !== "string" || !row.id || typeof row.label !== "string" ||
        !Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(stock) || stock <= 0 ||
        (maxPrice !== null && price > maxPrice) || (requestedVolume && (volume?.value !== requestedVolume.value || volume.unit !== requestedVolume.unit))) return [];
      return [{ price, stock, variantId: row.id, volume: row.label, image: typeof row.image === "string" && row.image ? row.image : product.image }];
    }).sort((a, b) => a.price - b.price)[0] ?? null;
  }
  const volume = volumeFromText(`${product.volumeValue ?? ""} ${product.volumeUnit ?? ""}`) ?? volumeFromText(product.name);
  if (product.stock <= 0 || product.price <= 0 || (maxPrice !== null && product.price > maxPrice) ||
    (requestedVolume && (volume?.value !== requestedVolume.value || volume.unit !== requestedVolume.unit))) return null;
  return { price: product.price, stock: product.stock, variantId: null, volume: "", image: product.image };
}

export function consultantDescription(product: ConsultantProduct) {
  const verified = verifiedProductCopy(product);
  const description = (verified?.description ?? product.description).split(/\r?\n/)
    .filter((line) => !hasMissingProductData(line)).join("\n").trim();
  const source = verified?.sourceUrl ?? product.enrichmentProposals?.[0]?.sourceUrl ?? null;
  let sourceUrl: string | null = null;
  if (source) { try { const url = new URL(source); if (url.protocol === "https:" || url.protocol === "http:") sourceUrl = url.href; } catch { /* Invalid source links are not exposed. */ } }
  return { description: description.slice(0, 3500), sourceUrl };
}

export function respectsIngredientExclusions(product: ConsultantProduct, query: string) {
  const exclusions: Array<[RegExp, RegExp]> = [
    [/без\s+ретин/iu, /retin|ретин/iu],
    [/без\s+(?:отдуш|ароматиз|парф)/iu, /parfum|fragrance|perfume|отдуш|ароматиз|парфюм/iu],
    [/без\s+(?:спирт|алког)/iu, /alcohol|ethanol|спирт/iu],
    [/без\s+сульфат/iu, /sulfate|сульфат/iu],
    [/без\s+парабен/iu, /paraben|парабен/iu],
    [/без\s+кислот/iu, /acid|кислот/iu],
    [/без\s+силикон/iu, /cone\b|conol\b|siloxane|силикон/iu],
  ];
  const restrictions = exclusions.filter(([question]) => question.test(query));
  if (!restrictions.length) return true;
  const ingredients = product.enrichmentProposals?.[0]?.ingredients?.trim();
  if (!ingredients || !consultantDescription(product).sourceUrl) return false;
  return restrictions.every(([, ingredient]) => !ingredient.test(ingredients));
}

const STOP_WORDS = new Set(["нужен", "нужна", "нужно", "подбери", "подберите", "средство", "средства", "уход", "кожи", "кожа", "меня", "какой", "какая", "можно", "пожалуйста", "бюджет", "тысяч", "товар", "вопрос", "который", "лучше", "хочу", "ищу"]);
export function rankConsultantProducts(products: ConsultantProduct[], criteria: ConsultantCriteria, productId = "") {
  const category = CATEGORY_OPTIONS.find((option) => option.slug === criteria.category) ?? null;
  const tokens = normalizeCatalogText(criteria.query).split(" ").filter((word) => word.length >= 4 && !STOP_WORDS.has(word) && !/^\d+$/.test(word))
    .map((word) => /^[а-я]+$/u.test(word) && word.length >= 7 ? word.slice(0, 6) : word);
  return products.flatMap((product) => {
    const target = product.id === productId;
    if (productId && !target) return [];
    if (!target && ((criteria.care && !productMatchesCare(product, criteria.care)) ||
      !productMatchesCategory(product, category) ||
      (criteria.brand && normalizeCatalogText(product.brand?.name).replaceAll(" ", "") !== criteria.brand))) return [];
    const offer = availableOffer(product, target ? null : criteria.maxPrice, target ? null : criteria.volume);
    const searchable = normalizeCatalogText([product.name, product.category, publicShortDescription(product.shortDescription), product.productLineName, product.brand?.name].join(" "));
    const lexicalScore = tokens.reduce((sum, token) => sum + (searchable.includes(token) ? 2 : 0), 0);
    const score = target ? 100 : lexicalScore + (criteria.care ? 10 : 0) + (category ? 6 : 0) + (criteria.brand ? 8 : 0);
    if (!target && (!offer || score === 0 || !respectsIngredientExclusions(product, criteria.query))) return [];
    return [{ product, offer, score }];
  }).sort((a, b) => b.score - a.score || (a.offer?.price ?? Infinity) - (b.offer?.price ?? Infinity) || a.product.id.localeCompare(b.product.id)).slice(0, 8);
}

export function recommendationFromProduct(product: ConsultantProduct, criteria: ConsultantCriteria, reason: string): ConsultantRecommendation | null {
  const offer = availableOffer(product, criteria.maxPrice, criteria.volume);
  if (!offer || !respectsIngredientExclusions(product, criteria.query)) return null;
  return { id: product.id, slug: product.slug, name: product.name, brand: product.brand?.name ?? "",
    category: publicProductCategory(product), ...offer, summary: publicShortDescription(product.shortDescription),
    reason: reason.slice(0, 400), sourceUrl: consultantDescription(product).sourceUrl };
}

export function validateConsultantReply(value: unknown, products: ConsultantProduct[], criteria: ConsultantCriteria) {
  if (!value || typeof value !== "object") throw new Error("invalid_ai_reply");
  const data = value as Record<string, unknown>;
  if (typeof data.answer !== "string" || !data.answer.trim() || data.answer.length > 5000 || !Array.isArray(data.recommendations)) throw new Error("invalid_ai_reply");
  const seen = new Set<string>();
  const recommendations = data.recommendations.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.productId !== "string" || typeof row.reason !== "string" || seen.has(row.productId)) return [];
    const product = products.find((product) => product.id === row.productId);
    if (!product) return [];
    seen.add(product.id);
    const card = recommendationFromProduct(product, criteria, row.reason);
    return card ? [card] : [];
  }).slice(0, 3);
  return { answer: data.answer.trim(), recommendations };
}

export function needsConsultantClarification(criteria: ConsultantCriteria, productId: string) {
  return !productId && !criteria.care && !criteria.category && !criteria.brand && /подбер|подбор|посовет|порекоменд|хочу уход|нужен уход/iu.test(criteria.query);
}

export function needsSpecialist(messages: string[]) {
  return /(?:леч(?:ить|ение|ением)|диагноз|псориаз|экзем|дерматит|ожог|сильн(?:ая|ое|ый)\s+(?:сыпь|жжение|покраснение)|беременн|аллерги|лекарств)/iu.test(messages.join(" "));
}
