/** Deterministic repricer. No network or marketplace writes. */
export type Strategy = "UNDERCUT" | "MATCH" | "TARGET";
export type RepricingPolicyInput = {
  strategy: Strategy;
  minPrice: number;
  maxPrice: number;
  minMarginPercent: number;
  feePercent: number;
  shippingCost: number;
  targetProfit: number;
  step: number;
  maxChangePercent: number;
  maxAgeMinutes: number;
  cooldownMinutes: number;
  adjustment: number;
};
export type CompetitorQuote = {
  id: string;
  seller: string;
  price: number;
  observedAt: string;
  sourceType: "MANUAL" | "VERIFIED_FEED";
};
export type RepricingResult = {
  status: "BLOCKED" | "NO_DATA" | "NO_CHANGE" | "SIMULATED" | "PROPOSED";
  reason: string;
  candidate: number | null;
  targetPrice: number | null;
  floorPrice: number | null;
  competitorPrice: number | null;
  observationIds: string[];
  mode: "DRY_RUN" | "AUTO_PROPOSE";
};
const isFiniteInt = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
function blocked(reason: string, mode: RepricingResult["mode"], extra?: Partial<RepricingResult>): RepricingResult {
  return { status: "BLOCKED", reason, candidate: null, targetPrice: null,
    floorPrice: null, competitorPrice: null, observationIds: [], mode, ...extra };
}

/** Cost + fee and margin must fit entirely inside the actual selling price. */
export function profitFloor(cost: number, rule: RepricingPolicyInput): number | null {
  if (!isFiniteInt(cost) || cost === 0 || !isFiniteInt(rule.shippingCost) ||
      !isFiniteInt(rule.targetProfit)) return null;
  if (!Number.isFinite(rule.feePercent) || !Number.isFinite(rule.minMarginPercent) ||
      rule.feePercent < 0 || rule.minMarginPercent < 0 ||
      rule.feePercent + rule.minMarginPercent >= 100) return null;
  return Math.ceil((cost + rule.shippingCost + rule.targetProfit) /
    (1 - (rule.feePercent + rule.minMarginPercent) / 100));
}

export function calculateRepricing(input: {
  rule: RepricingPolicyInput;
  quotes: CompetitorQuote[];
  currentPrice: number | null;
  purchasePrice: number | null;
  mode: "DRY_RUN" | "AUTO_PROPOSE";
  autoEnabled: boolean;
  emergencyStop: boolean;
  lastProposedAt?: string | null;
  now?: string;
}): RepricingResult {
  const { rule, mode } = input;
  if (!isFiniteInt(rule.minPrice) || !isFiniteInt(rule.maxPrice) || rule.minPrice < 1 ||
      rule.maxPrice < rule.minPrice || !isFiniteInt(rule.step) || rule.step < 1 ||
      !isFiniteInt(rule.adjustment) || !isFiniteInt(rule.maxAgeMinutes) ||
      rule.maxAgeMinutes < 1 || !isFiniteInt(rule.cooldownMinutes) ||
      !Number.isFinite(rule.maxChangePercent) || rule.maxChangePercent <= 0 ||
      rule.maxChangePercent > 100) return blocked("INVALID_POLICY", mode);
  if (!isFiniteInt(input.currentPrice) || !input.currentPrice ||
      input.currentPrice < 1) return blocked("PRICE_UNKNOWN", mode);
  const costFloor = profitFloor(input.purchasePrice ?? -1, rule);
  if (!costFloor) return blocked("COST_OR_MARGIN_UNKNOWN", mode);
  const floorPrice = Math.max(rule.minPrice, costFloor);
  if (floorPrice > rule.maxPrice) return blocked("MARGIN_EXCEEDS_MAXIMUM", mode,
    { floorPrice });
  if (input.currentPrice < floorPrice || input.currentPrice > rule.maxPrice) {
    return blocked("CURRENT_PRICE_OUTSIDE_BOUNDS", mode, { floorPrice });
  }

  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  if (!Number.isFinite(nowMs)) return blocked("INVALID_CLOCK", mode, { floorPrice });
  if (input.emergencyStop && mode === "AUTO_PROPOSE") {
    return blocked("EMERGENCY_STOP", mode, { floorPrice });
  }
  if (mode === "AUTO_PROPOSE" && !input.autoEnabled) {
    return blocked("AUTOMATION_DISABLED", mode, { floorPrice });
  }
  const fresh = input.quotes.filter((q) =>
    isFiniteInt(q.price) && q.price > 0 && q.price <= 1000000000 &&
    Number.isFinite(Date.parse(q.observedAt)) &&
    Date.parse(q.observedAt) <= nowMs &&
    nowMs - Date.parse(q.observedAt) <= rule.maxAgeMinutes * 60000 &&
    (mode === "DRY_RUN" || q.sourceType === "VERIFIED_FEED"));
  if (!fresh.length) return {
    status: "NO_DATA", reason: mode === "DRY_RUN" ? "NO_FRESH_QUOTES" : "NO_VERIFIED_QUOTES",
    candidate: null, targetPrice: null, floorPrice, competitorPrice: null,
    observationIds: [], mode,
  };

  if (mode === "AUTO_PROPOSE" && input.lastProposedAt) {
    const lastMs = Date.parse(input.lastProposedAt);
    if (Number.isFinite(lastMs) && nowMs - lastMs < rule.cooldownMinutes * 60000) {
      return blocked("COOLDOWN", mode, { floorPrice });
    }
  }
  const lowest = [...fresh].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
  const candidate = rule.strategy === "UNDERCUT" ? lowest.price - rule.adjustment :
    rule.strategy === "MATCH" ? lowest.price : rule.maxPrice;
  if (candidate < floorPrice) return blocked("COMPETITOR_BELOW_FLOOR", mode,
    { candidate, floorPrice, competitorPrice: lowest.price, observationIds: [lowest.id] });
  const bounded = Math.min(rule.maxPrice, candidate);
  // Round downward to preserve undercut guarantee. Never round below floor.
  const rounded = Math.floor(bounded / rule.step) * rule.step;
  if (rounded < floorPrice) return blocked("ROUNDING_BELOW_FLOOR", mode,
    { candidate, floorPrice, competitorPrice: lowest.price, observationIds: [lowest.id] });
  const maxDelta = Math.max(rule.step, Math.floor(input.currentPrice * rule.maxChangePercent / 100));
  const difference = rounded - input.currentPrice;
  let limited = input.currentPrice + Math.sign(difference) *
    Math.min(Math.abs(difference), maxDelta);
  // Do not publish a price that is not aligned with configured step.
  limited = difference >= 0 ?
    Math.floor(limited / rule.step) * rule.step :
    Math.ceil(limited / rule.step) * rule.step;
  limited = Math.max(floorPrice, Math.min(rule.maxPrice, limited));
  // Use the exact floor when rounding cannot yield a step-aligned price inside bounds.
  if (limited < floorPrice || limited > rule.maxPrice) return blocked("OUTSIDE_BOUNDS", mode,
    { candidate, floorPrice });
  if (limited === input.currentPrice) return {
    status: "NO_CHANGE", reason: "PRICE_ALREADY_OPTIMAL", candidate,
    targetPrice: limited, floorPrice, competitorPrice: lowest.price,
    observationIds: [lowest.id], mode,
  };
  return {
    status: mode === "AUTO_PROPOSE" ? "PROPOSED" : "SIMULATED",
    reason: limited !== rounded ? "LIMITED_BY_MAX_CHANGE" : "WITHIN_BOUNDS",
    candidate, targetPrice: limited, floorPrice,
    competitorPrice: lowest.price, observationIds: [lowest.id], mode,
  };
}
