import { profitFloor } from "./repricing-engine.ts";
import { RequestError } from "./request-context.ts";
export type FinancialPolicy = {
  minPrice: number; maxPrice: number; shippingCost: number;
  targetProfit: number; feePercent: number; minMarginPercent: number;
};
export function channelCode(adapter: string): string | null {
  return ({ OWN_STORE:"STORE",KASPI_XML:"KASPI",OZON:"OZON",WILDBERRIES:"WILDBERRIES" } as Record<string,string>)[adapter] || null;
}
export function financialPolicy(row: Record<string,unknown> | undefined): FinancialPolicy | null {
  if (!row) return null;
  return { minPrice:Number(row.minPrice),maxPrice:Number(row.maxPrice),shippingCost:Number(row.shippingCost),
    targetProfit:Number(row.targetProfit),feePercent:Number(row.feePercent),minMarginPercent:Number(row.minMarginPercent) };
}
export function assertFinancialPrice(price: number, purchasePrice: number | null, policy: FinancialPolicy | null) {
  if (!Number.isSafeInteger(price) || price < 1 || purchasePrice === null || !Number.isSafeInteger(purchasePrice) || purchasePrice < 1) {
    throw new RequestError("cost_or_price_floor_invalid",409);
  }
  const costFloor=policy?profitFloor(purchasePrice,policy):purchasePrice;
  if (!costFloor || policy && (!Number.isSafeInteger(policy.minPrice) || policy.minPrice<1 ||
      !Number.isSafeInteger(policy.maxPrice) || policy.maxPrice<policy.minPrice)) throw new RequestError("cost_or_price_floor_invalid",409);
  const floor=Math.max(costFloor,policy?.minPrice || 1);
  if(price<floor || policy && price>policy.maxPrice) throw new RequestError("offer_outside_financial_bounds",409);
  return floor;
}
