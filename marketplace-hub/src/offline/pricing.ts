import { z } from "zod";

export const pricingRuleSchema = z.object({
  name: z.string().trim().min(1),
  priority: z.number().int().default(100),
  minPurchase: z.number().int().nonnegative().optional(),
  maxPurchase: z.number().int().nonnegative().optional(),
  markupPercent: z.number().nonnegative().optional(),
  fixedMarkup: z.number().int().nonnegative().optional(),
  roundingStep: z.number().int().positive().default(10),
});

export type PricingRuleInput = z.infer<typeof pricingRuleSchema>;

export function calculatePrice(
  purchasePrice: number,
  rules: PricingRuleInput[],
) {
  if (!Number.isInteger(purchasePrice) || purchasePrice < 0) {
    throw new Error("purchasePrice must be a non-negative integer");
  }

  const normalized = rules
    .map((rule) => pricingRuleSchema.parse(rule))
    .sort((a, b) => a.priority - b.priority);

  const matched =
    normalized.find((rule) => {
      if (rule.minPurchase !== undefined && purchasePrice < rule.minPurchase) {
        return false;
      }
      if (rule.maxPurchase !== undefined && purchasePrice > rule.maxPurchase) {
        return false;
      }
      return true;
    }) ?? {
      name: "Default",
      priority: Number.MAX_SAFE_INTEGER,
      markupPercent: 0,
      fixedMarkup: 0,
      roundingStep: 10,
    };

  const percent = matched.markupPercent ?? 0;
  const fixed = matched.fixedMarkup ?? 0;
  const raw = purchasePrice * (1 + percent / 100) + fixed;
  const step = matched.roundingStep ?? 10;
  const price = Math.ceil(raw / step) * step;

  return {
    rule: matched.name,
    purchasePrice,
    markupPercent: percent,
    fixedMarkup: fixed,
    rawPrice: Math.round(raw),
    price,
  };
}
