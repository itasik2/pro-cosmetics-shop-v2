// lib/order.ts
import { prisma } from "@/lib/prisma";
import { parseCartKey, type CartItem } from "@/lib/cartStorage";

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
};

type BuildOrderError = "empty_cart" | "nothing_to_order" | null;

export function normalizeVariants(v: any): Variant[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({
      id: String(x?.id ?? ""),
      label: String(x?.label ?? ""),
      price: Math.trunc(Number(x?.price) || 0),
      stock: Math.trunc(Number(x?.stock) || 0),
      sku: x?.sku ? String(x.sku) : undefined,
    }))
    .filter((x) => x.id && x.label);
}

export function makeOrderNumber() {
  // YYYYMMDD-XXXXXX (коротко, уникально)
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${y}${m}${day}-${rand}`;
}

export async function buildOrderFromCart(cart: CartItem[]) {
  // 1) нормализуем корзину и собираем ids
  const safeCart = (Array.isArray(cart) ? cart : [])
    .map((x) => ({ id: String(x?.id ?? ""), qty: Math.trunc(Number(x?.qty) || 0) }))
    .filter((x) => x.id && x.qty > 0)
    .slice(0, 200);

  const productIds = Array.from(
    new Set(safeCart.map((x) => parseCartKey(x.id).productId).filter(Boolean)),
  ).slice(0, 100);

  if (safeCart.length === 0 || productIds.length === 0) {
    return { items: [], total: 0, error: "empty_cart" as const };
  }

  // 2) грузим товары
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      name: true,
      price: true,
      stock: true,
      image: true,
      variants: true,
    },
  });

  const map = new Map(products.map((p) => [p.id, p]));

  // 3) собираем позиции заказа (snapshot)
  const items: Array<{
    productId: string;
    variantId: string | null;
    title: string;
    unitPrice: number;
    qty: number;
    lineTotal: number;
    image?: string | null;
    sku?: string | null;
  }> = [];

  for (const it of safeCart) {
    const { productId, variantId } = parseCartKey(it.id);
    const p = map.get(productId);
    if (!p) continue;

    const variants = normalizeVariants(p.variants);
    const v = variantId ? variants.find((x) => x.id === variantId) : null;

    const unitPrice = v ? v.price : p.price;
    const stock = v ? v.stock : p.stock;

    // если товара нет в наличии — не добавляем
    if (stock <= 0 || unitPrice <= 0) continue;

    const qty = Math.max(1, Math.min(it.qty, stock));
    const title = v ? `${p.name} (${v.label})` : p.name;

    items.push({
      productId: p.id,
      variantId: v ? v.id : null,
      title,
      unitPrice,
      qty,
      lineTotal: unitPrice * qty,
      image: p.image ?? null,
      sku: v?.sku ?? null,
    });
  }

  

  const total = items.reduce((s, x) => s + x.lineTotal, 0);

  if (items.length === 0 || total <= 0) {
    return { items: [], total: 0, error: "nothing_to_order" as const };
  }

  return { items, total, error: null as BuildOrderError };
}
