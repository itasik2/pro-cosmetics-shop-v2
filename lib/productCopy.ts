// Editorial notes stay in the stored description for review, not in sales copy.
export const MISSING_PRODUCT_DATA = /(?:подтвержд[её]нные?\s+(?:задачи|преимущества)|(?:тип кожи|преимущества|задачи|схема применения|данные|информация).{0,80}(?:не указан|не уточн|недостаточ|отсутств)|в (?:доступных данных|источнике).{0,80}(?:не указан|не уточн))/iu;

export function publicShortDescription(value: string | null | undefined) {
  return String(value || "").split(/(?<=[.!?])\s+/u).filter((sentence) => !MISSING_PRODUCT_DATA.test(sentence)).join(" ").trim();
}

export function hasMissingProductData(value: string) {
  return MISSING_PRODUCT_DATA.test(value);
}
