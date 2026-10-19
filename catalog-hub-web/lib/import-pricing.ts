import type { ImportItem } from "./import-parser";

export type PriceRule = {
  mode: "PRICE_AS_IS" | "MARKUP_PERCENT" | "SOURCE_ONLY";
  markupPercent: number;
  roundingStep: 1 | 10 | 50 | 100;
};

export const DEFAULT_PRICE_RULE: PriceRule = {
  mode: "PRICE_AS_IS", markupPercent: 20, roundingStep: 100,
};

export function parsePriceRule(raw: unknown): PriceRule {
  if (raw === null || raw === undefined || raw === "") return { ...DEFAULT_PRICE_RULE };
  let value: unknown;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { throw new Error("invalid_price_rule"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_price_rule");
  const rule = value as Record<string, unknown>;
  if (!(["PRICE_AS_IS", "MARKUP_PERCENT", "SOURCE_ONLY"] as unknown[]).includes(rule.mode) ||
      typeof rule.markupPercent !== "number" || !Number.isInteger(rule.markupPercent) ||
      rule.markupPercent < 0 || rule.markupPercent > 500 ||
      !([1, 10, 50, 100] as unknown[]).includes(rule.roundingStep))
    throw new Error("invalid_price_rule");
  return {
    mode: rule.mode as PriceRule["mode"], markupPercent: rule.markupPercent,
    roundingStep: rule.roundingStep as PriceRule["roundingStep"],
  };
}

export function priceImportItems(items: ImportItem[], rule: PriceRule): ImportItem[] {
  return items.map(item => {
    const errors = [...item.errors];
    if (rule.mode === "MARKUP_PERCENT") {
      if (item.purchasePrice === undefined || item.purchasePrice <= 0)
        errors.push("Для наценки нужна положительная закупочная цена");
      else {
        const price = Math.ceil(item.purchasePrice * (1 + rule.markupPercent / 100) / rule.roundingStep) * rule.roundingStep;
        if (price > 2_147_483_647) errors.push("Рассчитанная цена превышает допустимый предел");
        else item = { ...item, price };
      }
    }
    if (rule.mode === "SOURCE_ONLY") {
      if (item.purchasePrice === undefined || item.purchasePrice <= 0)
        errors.push("Для обновления закупочной цены нужна положительная закупочная цена");
      // A newly created Hub product still needs a retail price; whether to
      // create it is checked after matching against the current catalog.
      item = { ...item, price: undefined };
    }
    return { ...item, errors };
  });
}
