// Editorial notes stay in the stored description for review, not in sales copy.
export const MISSING_PRODUCT_DATA = /(?:подтвержд[её]нные?\s+(?:задачи|преимущества)|(?:тип кожи|преимущества|задачи|схема применения|способ применения|рекомендации|инструкци[яи]|сведени[яй]|данные|информация|состав).{0,240}(?:не указан|не уточн|не подтвержд|недостаточ|отсутств)|в (?:доступных данных|(?:предоставленном )?источнике).{0,80}(?:не указан|не уточн|отсутств))/iu;

export function customerProductCopy(value: string | null | undefined) {
  return String(value || "").replace(/\r\n?/g, "\n").split("\n")
    .map((line) => line.split(/(?<=[.!?])\s+/u)
      .filter((sentence) => !MISSING_PRODUCT_DATA.test(sentence)).join(" ").trim())
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function publicShortDescription(value: string | null | undefined) {
  return customerProductCopy(value).replace(/\s+/g, " ").trim();
}

export function hasMissingProductData(value: string) {
  return MISSING_PRODUCT_DATA.test(value);
}
