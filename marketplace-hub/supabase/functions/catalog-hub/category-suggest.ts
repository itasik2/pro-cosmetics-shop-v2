/**
 * Transparent rules, not AI or external-marketplace classification.
 * These scores are advisory and NEVER update Product.categoryKey automatically.
 */
export type CategorySuggestion = { key: string; score: number; reason: string };
type ProductText = { title?: string | null; shortDescription?: string | null; description?: string | null };
type Rule = { key: string; tokens: RegExp; hint: string };
const rules: Rule[] = [
  { key:"Уход за волосами", tokens:/hair growth|\bscalp\b|роста волос|волос|кожи головы/i, hint:"Уход за волосами" },
  { key:"Уход за губами", tokens:/lip balm|\blip\b|бальзам для губ|уход за губами/i, hint:"Уход за губами" },
  { key:"Ретиноиды", tokens:/ретиноид|ретинол|ретинал|\bhpr\b|retinol|retinal/i, hint:"Ретиноиды" },
  { key:"Осветление", tokens:/demela|mela[ -]?bright|mask black for white|pigment|пигмент|осветлен|осветление|транексам|brightening/i, hint:"Осветление и коррекция пигментации" },
  { key:"Проблемная кожа", tokens:/acno[ -]?cell|\bacne\b|акне|проблемн|себум|салицил|противовоспалительн/i, hint:"Уход за проблемной кожей" },
  { key:"Антивозрастной уход", tokens:/reform[e]?[ -]?age|reju[ -]?wrinkle|anti[ -]?age|антивозраст|морщин|лифтинг|омолаж|возрастн/i, hint:"Антивозрастной уход" },
  { key:"Чувствительная кожа", tokens:/my[ -]?ato|\bprobio\b|чувствительн|микробиом|кожн(ый|ого) барьер/i, hint:"Уход за чувствительной кожей" },
  { key:"Очищение и тонизация", tokens:/cleanser|\bclean\b|toner|tonic|очищ|умыван|мицелляр|тоник|тонер/i, hint:"Очищение и тонизация" },
  { key:"Пилинги", tokens:/\bpeel\b|пилинг|гоммаж|\bacid pad\b|эксфолиант/i, hint:"Пилинги и эксфолиация" },
  { key:"Регенерация", tokens:/post[ -]?procedure|восстановлен|регенерац|репарант|\brepair\b|после процедур/i, hint:"Восстановление кожи" },
  { key:"Увлажнение", tokens:/hydrat|hyal|hydrogel|гиалурон|увлажн|обезвоженн/i, hint:"Увлажнение" },
  { key:"Дренаж", tokens:/лимфодренаж|\bdetox\b|дренаж|отечност/i, hint:"Лимфодренаж" },
  { key:"Защита от солнца", tokens:/\bspf\s*\d+|солнцезащит|\bsunscreen\b/i, hint:"Защита от солнца" },
  { key:"Антикупероз", tokens:/купероз|розацеа/i, hint:"Антикупероз" },
  { key:"Ароматерапия", tokens:/ароматерап|\bdiffuser\b|диффузор/i, hint:"Ароматерапия" },
  { key:"Уход за полостью рта", tokens:/полости рта|ополаскиватель для рта/i, hint:"Уход за полостью рта" },
];
export function suggestCategories(product: ProductText, allowedKeys: readonly string[]): CategorySuggestion[] {
  const title = (product.title || "").slice(0,500);
  const details = ((product.shortDescription || "") + " " + (product.description || "")).slice(0,2400);
  const allowed = new Set(allowedKeys);
  const results: CategorySuggestion[] = [];
  for (const r of rules) {
    if (!allowed.has(r.key)) continue;
    const inTitle = r.tokens.test(title);
    const inDetails = r.tokens.test(details);
    const score = (inTitle ? 5 : 0) + (inDetails ? 1 : 0);
    // A description-only clue is insufficient for a safe suggestion.
    if (score < 5) continue;
    results.push({ key:r.key, score, reason:r.hint + (inTitle ? " — совпадение в названии" : "") });
  }
  return results.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key,"ru")).slice(0,3);
}
