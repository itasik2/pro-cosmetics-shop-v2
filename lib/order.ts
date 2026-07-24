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

export function normalizeVariants(value: unknown): Variant[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: String(row.id ?? ""),
        label: String(row.label ?? ""),
        price: Math.trunc(Number(row.price) || 0),
        stock: Math.trunc(Number(row.stock) || 0),
        sku: row.sku ? String(row.sku) : undefined,
      };
    })
    .filter((variant) => variant.id && variant.label);
}

export function makeOrderNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${year}${month}${day}-${random}`;
}

export async function buildOrderFromCart(cart: CartItem[]) {
  const safeCart = (Array.isArray(cart) ? cart : [])
    .map((item) => ({
      id: String(item?.id ?? ""),
      qty: Math.trunc(Number(item?.qty) || 0),
    }))
    .filter((item) => item.id && item.qty > 0)
    .slice(0, 200);

  const productIds = Array.from(
    new Set(
      safeCart
        .map((item) => parseCartKey(item.id).productId)
        .filter(Boolean),
    ),
  ).slice(0, 100);

  if (safeCart.length === 0 || productIds.length === 0) {
    return { items: [], total: 0, error: "empty_cart" as const };
  }

  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      isPublished: true,
    },
    select: {
      id: true,
      name: true,
      price: true,
      stock: true,
      image: true,
      variants: true,
    },
  });

  const productMap = new Map(products.map((product) => [product.id, product]));
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

  for (const cartItem of safeCart) {
    const { productId, variantId } = parseCartKey(cartItem.id);
    const product = productMap.get(productId);
    if (!product) continue;

    const variants = normalizeVariants(product.variants);
    const variant = variantId
      ? variants.find((item) => item.id === variantId)
      : null;

    const unitPrice = variant ? variant.price : product.price;
    const stock = variant ? variant.stock : product.stock;
    if (stock <= 0 || unitPrice <= 0) continue;

    const qty = Math.max(1, Math.min(cartItem.qty, stock));
    const title = variant
      ? `${product.name} (${variant.label})`
      : product.name;

    items.push({
      productId: product.id,
      variantId: variant ? variant.id : null,
      title,
      unitPrice,
      qty,
      lineTotal: unitPrice * qty,
      image: product.image ?? null,
      sku: variant?.sku ?? null,
    });
  }

  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (items.length === 0 || total <= 0) {
    return { items: [], total: 0, error: "nothing_to_order" as const };
  }

  return { items, total, error: null as BuildOrderError };
}
