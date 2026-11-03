import { RequestError } from "./request-context.ts";

export function textField(value: unknown, name: string, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new RequestError("invalid_" + name);
  return value.trim();
}
export function integer(value: unknown, name: string, min = 0, max = 1_000_000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new RequestError("invalid_" + name);
  return value;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, "0")).join("");
}
export function operationKey(req: Request): string {
  const key = req.headers.get("idempotency-key") || "";
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new RequestError("idempotency_key_required");
  return key;
}
export type Balance = { onHand: number; reserved: number; safetyStock: number; revision: number };
export function available(balance: Pick<Balance, "onHand" | "reserved" | "safetyStock">, buffer = 0) {
  return Math.max(0, balance.onHand - balance.reserved - balance.safetyStock - buffer);
}
export function nextBalance(before: Balance, deltaOnHand: number, deltaReserved: number, buffer = 0): Balance {
  if (deltaReserved > 0 && available(before, buffer) < deltaReserved) throw new RequestError("insufficient_available_stock", 409);
  const onHand = before.onHand + deltaOnHand, reserved = before.reserved + deltaReserved;
  if (![onHand, reserved].every(Number.isSafeInteger) || onHand < 0 || reserved < 0 || onHand < reserved || onHand > 2_000_000_000) {
    throw new RequestError("stock_below_reserved", 409);
  }
  return { ...before, onHand, reserved, revision: before.revision + 1 };
}
export type OrderItem = { productId: string; warehouseId: string; quantity: number };
export function orderItems(value: unknown): OrderItem[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new RequestError("invalid_order_items");
  const combined = new Map<string, OrderItem>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestError("invalid_order_item");
    const item = raw as Record<string, unknown>;
    const productId = textField(item.productId, "product"), warehouseId = textField(item.warehouseId, "warehouse");
    const quantity = integer(item.quantity, "quantity", 1, 100_000), key = productId + "\u0000" + warehouseId;
    const previous = combined.get(key);
    combined.set(key, { productId, warehouseId, quantity: integer(quantity + (previous?.quantity || 0), "quantity", 1, 100_000) });
  }
  return Array.from(combined.values()).sort((a, b) => a.productId.localeCompare(b.productId) || a.warehouseId.localeCompare(b.warehouseId));
}

export const adapters = {
  OWN_STORE: { kind: "OWN_STORE", capabilities: ["CATALOG_EXPORT", "ORDER_EVENTS", "SHADOW_DIFF"] },
  KASPI_XML: { kind: "MARKETPLACE", capabilities: ["FULL_PRICE_FEED"] },
  OZON: { kind: "MARKETPLACE", capabilities: [] },
  WILDBERRIES: { kind: "MARKETPLACE", capabilities: [] },
  GENERIC_ERP: { kind: "ERP", capabilities: ["CATALOG_EXPORT"] },
} as const;

export function retryDelay(attempt: number, random = Math.random()): number {
  return Math.min(3600, 5 * 2 ** Math.min(attempt, 10)) + Math.floor(Math.max(0, Math.min(1, random)) * 5);
}
