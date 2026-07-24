export type PriceMode = "PRICE_AS_IS" | "MARKUP_PERCENT" | "SOURCE_ONLY";

const PRICE_MODES = new Set<PriceMode>([
  "PRICE_AS_IS",
  "MARKUP_PERCENT",
  "SOURCE_ONLY",
]);

export function normalizePriceMode(value: unknown): PriceMode {
  const mode = String(value || "PRICE_AS_IS").toUpperCase() as PriceMode;
  return PRICE_MODES.has(mode) ? mode : "PRICE_AS_IS";
}

export function normalizeMarkupPercent(value: unknown) {
  const number = Math.trunc(Number(value) || 0);
  return Math.min(500, Math.max(0, number));
}

export function normalizeRoundingStep(value: unknown) {
  const number = Math.trunc(Number(value) || 100);
  return [1, 10, 50, 100].includes(number) ? number : 100;
}

export function calculateSalePrice(input: {
  sourcePrice: number;
  recommendedPrice?: number | null;
  priceMode: PriceMode;
  markupPercent: number;
  roundingStep: number;
}) {
  const sourcePrice = Math.max(0, Math.trunc(input.sourcePrice));
  const recommendedPrice = Math.max(0, Math.trunc(input.recommendedPrice || 0));
  const rawPrice =
    input.priceMode === "MARKUP_PERCENT"
      ? sourcePrice * (1 + input.markupPercent / 100)
      : input.priceMode === "PRICE_AS_IS" && recommendedPrice > 0
        ? recommendedPrice
        : sourcePrice;

  const step = normalizeRoundingStep(input.roundingStep);
  return Math.max(0, Math.ceil(rawPrice / step) * step);
}
