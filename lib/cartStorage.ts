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

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as CartItem[]) : [];
    const base = Array.isArray(arr)
      ? arr.filter(
          (x) =>
            x &&
            typeof x.id === "string" &&
            typeof x.qty === "number" &&
            x.id.length > 0,
        )
      : [];

    // Миграция старого формата: productId -> productId:base
    const migrated = base.map((x) => ({
      ...x,
      id: x.id.includes(":") ? x.id : `${x.id}:base`,
    }));

    // если были изменения — перезапишем один раз
    const changed = migrated.some((x, i) => x.id !== base[i].id);
    if (changed) {
      localStorage.setItem(KEY, JSON.stringify(migrated));
      dispatchSync();
    }

    return migrated;
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items));
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
