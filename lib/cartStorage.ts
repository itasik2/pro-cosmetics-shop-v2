// lib/cartStorage.ts
export type CartItem = { id: string; qty: number };

export type CartKeyParsed = { productId: string; variantId: string | null };

const KEY = "cart";

function dispatchSync() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("storage-sync"));
}

export function parseCartKey(id: string): CartKeyParsed {
  const s = String(id || "");
  const [productId, variantRaw] = s.split(":");
  const variantId = variantRaw && variantRaw !== "base" ? variantRaw : null;
  return { productId, variantId };
}

export function makeCartKey(productId: string, variantId?: string | null) {
  return `${productId}:${variantId ?? "base"}`;
}

function normalizeCartItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];

  const merged = new Map<string, number>();

  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== "object") continue;

    const item = rawItem as Partial<CartItem>;
    const rawId = typeof item.id === "string" ? item.id.trim() : "";
    const qty = Math.trunc(Number(item.qty));
    if (!rawId || !Number.isFinite(qty) || qty <= 0) continue;

    // Миграция старого формата: productId -> productId:base.
    const id = rawId.includes(":") ? rawId : `${rawId}:base`;
    const { productId } = parseCartKey(id);
    if (!productId) continue;

    // Повтор одной и той же позиции считаем повреждённым дублем, а не новой покупкой.
    // Берём большее количество, чтобы нормализация сама не увеличивала сумму заказа.
    merged.set(id, Math.max(merged.get(id) || 0, qty));
  }

  return Array.from(merged, ([id, qty]) => ({ id, qty }));
}

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const normalized = normalizeCartItems(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      localStorage.setItem(KEY, JSON.stringify(normalized));
      dispatchSync();
    }

    return normalized;
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(normalizeCartItems(items)));
  dispatchSync();
}

export function getQty(id: string): number {
  const cart = getCart();
  const found = cart.find((x) => x.id === id);
  return found?.qty ?? 0;
}

function clamp(qty: number, stock?: number) {
  let q = Math.trunc(Number(qty) || 0);
  if (q < 0) q = 0;
  if (typeof stock === "number") q = Math.min(q, Math.max(0, stock));
  return q;
}

export function setQty(id: string, qty: number, stock?: number): number {
  const safe = clamp(qty, stock);

  const cart = getCart();
  const idx = cart.findIndex((x) => x.id === id);

  if (safe <= 0) {
    if (idx >= 0) cart.splice(idx, 1);
    writeCart(cart);
    return 0;
  }

  if (idx >= 0) cart[idx] = { id, qty: safe };
  else cart.push({ id, qty: safe });

  writeCart(cart);
  return safe;
}

export function inc(id: string, stock?: number): number {
  const current = getQty(id);
  return setQty(id, current + 1, stock);
}

export function dec(id: string): number {
  const current = getQty(id);
  return setQty(id, current - 1);
}

export function clampCartToStock(stockMap: Map<string, number>) {
  const cart = getCart();
  let changed = false;

  const next = cart
    .map((it) => {
      const stock = stockMap.get(it.id);
      if (typeof stock !== "number") return it;
      const safe = clamp(it.qty, stock);
      if (safe !== it.qty) changed = true;
      return safe <= 0 ? null : { id: it.id, qty: safe };
    })
    .filter(Boolean) as CartItem[];

  if (changed) writeCart(next);
}
