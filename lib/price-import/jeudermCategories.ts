/**
 * Conservative classification for JeuDerm supplier PDF cards.
 * Return null when the product is not confidently recognized: do not guess
 * from ingredients or overrule an editor's existing category.
 */
export function suggestJeudermCategory(name: string): string | null {
  const normalized = String(name || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const has = (...terms: string[]) => terms.some((term) => normalized.includes(term));

  if (has("hair growth")) return "Уход за волосами и душем";
  if (has("mela bright", "mask black for white")) return "Осветление";
  if (has("reju wrinkle", "cream forte lift", "reform age", "reforme age", "ala factor")) {
    if (has("eye cream", "крем для глаз")) return "Глаза и губы";
    if (has("mild cleanser")) return "Очищение и тонизация";
    return "Антивозрастной уход";
  }
  if (has("acno cell", "acnocell", "acnocel")) return "Проблемная кожа";
  if (has("adaptive skin detox")) return "Дренаж";
  if (has("adaptive skin probio")) return "Восстановление кожного барьера";
  if (has("bb крем perfector")) return "Защита от солнца";
  if (has("carboxy therapy")) return "Карбокситерапия";
  if (has("demela molecular")) return "Пилинги";
  if (has("hydrogel mask", "intesive hyal hydratant")) return "Увлажнение";
  if (has("megapolis universal clean")) return "Очищение и тонизация";
  if (has("my ato")) return "Чувствительная кожа";
  if (has("pps восстанавливающий")) return "Регенерация";
  if (has("rejusome exo boost", "крем для глаз rejusome")) {
    if (has("lip balm")) return "Уход за губами";
    if (has("eye cream", "крем для глаз")) return "Глаза и губы";
    if (has("mist")) return "Увлажнение";
    return "Регенерация";
  }
  if (has("repair mask post")) return "Регенерация";
  return null;
}
