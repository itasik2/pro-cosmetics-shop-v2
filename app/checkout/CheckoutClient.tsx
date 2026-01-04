"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  clampCartToStock,
  getCart,
  setQty as setQtyStorage,
  writeCart,
  parseCartKey,
} from "@/lib/cartStorage";

type CartItem = { id: string; qty: number }; // id = cartKey: "productId:variantId|base"

type ProductVariant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
};

type Product = {
  id: string;
  name: string;
  image: string;
  price: number; // базовая цена
  stock: number; // базовый stock
  category: string;
  brand?: { name: string } | null;

  // ДОБАВИТЬ в API: variants из Prisma Json
  variants?: any;
};

function normalizeVariants(v: any): ProductVariant[] {
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

export default function CheckoutClient() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sync = () => setCart(getCart());

  useEffect(() => {
    sync();
    const onSync = () => sync();
    window.addEventListener("storage", onSync);
    window.addEventListener("storage-sync", onSync);
    return () => {
      window.removeEventListener("storage", onSync);
      window.removeEventListener("storage-sync", onSync);
    };
  }, []);

  // ключ только по набору PRODUCT IDs (без variant), чтобы не дергать API при изменении qty
  const idsKey = useMemo(() => {
    const productIds = cart
      .map((x) => parseCartKey(x.id).productId)
      .filter(Boolean);
    const unique = Array.from(new Set(productIds)).sort();
    return unique.join("|");
  }, [cart]);

  // загрузка товаров только когда меняется набор productId
  useEffect(() => {
    (async () => {
      setErr(null);

      const productIds = cart
        .map((x) => parseCartKey(x.id).productId)
        .filter(Boolean);
      const uniqueIds = Array.from(new Set(productIds)).slice(0, 100);

      if (uniqueIds.length === 0) {
        setProducts([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch("/api/products/by-ids", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: uniqueIds }),
        });
        const data = (await res.json()) as { products: Product[]; error?: string };
        if (!res.ok) throw new Error(data?.error || "Не удалось загрузить товары");
        setProducts(data.products || []);
      } catch (e: any) {
        setErr(e?.message || "Не удалось загрузить товары");
        setProducts([]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Карта продуктов по productId
  const productMap = useMemo(() => {
    return new Map(products.map((p) => [p.id, p]));
  }, [products]);

  // режем qty до stock с учетом ВАРИАНТА
  useEffect(() => {
    if (products.length === 0) return;

    const stockMap = new Map<string, number>();

    for (const it of cart) {
      const { productId, variantId } = parseCartKey(it.id);
      const p = productMap.get(productId);
      if (!p) continue;

      const variants = normalizeVariants(p.variants);
      if (variantId) {
        const v = variants.find((x) => x.id === variantId);
        stockMap.set(it.id, v ? v.stock : 0);
      } else {
        // base
        stockMap.set(it.id, p.stock);
      }
    }

    clampCartToStock(stockMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, idsKey]);

  const rows = useMemo(() => {
    // рендерим по корзине, чтобы показывались несколько вариантов одного товара
    return cart
      .map((it) => {
        const { productId, variantId } = parseCartKey(it.id);
        const p = productMap.get(productId);
        if (!p) return null;

        const variants = normalizeVariants(p.variants);
        const v = variantId ? variants.find((x) => x.id === variantId) : null;

        const title = v ? `${p.name} (${v.label})` : p.name;
        const unitPrice = v ? v.price : p.price;
        const stock = v ? v.stock : p.stock;

        return {
          cartKey: it.id,
          productId,
          variantId,
          qty: it.qty,
          title,
          unitPrice,
          stock,
          image: p.image,
          brandOrCategory: p.brand?.name ?? p.category,
          link: `/shop/${p.id}`,
        };
      })
      .filter(Boolean) as Array<{
      cartKey: string;
      productId: string;
      variantId: string | null;
      qty: number;
      title: string;
      unitPrice: number;
      stock: number;
      image: string;
      brandOrCategory: string;
      link: string;
    }>;
  }, [cart, productMap]);

  const total = useMemo(() => {
    return rows.reduce((sum, r) => sum + r.unitPrice * r.qty, 0);
  }, [rows]);

  const clear = () => {
    writeCart([]);
    sync();
  };

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Оформление</h2>
          <div className="text-sm text-gray-500 mt-1">
            {cart.length} поз. • Итого: {total.toLocaleString("ru-RU")} ₸
          </div>
        </div>

        <div className="flex gap-2">
          <Link
            href="/shop"
            className="px-3 py-1 rounded-full text-sm border bg-white text-gray-700 hover:bg-gray-50"
          >
            В каталог
          </Link>
          <button
            onClick={clear}
            className="px-3 py-1 rounded-full text-sm border bg-white text-gray-700 hover:bg-gray-50"
            type="button"
          >
            Очистить
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Загрузка…</div>
      ) : err ? (
        <div className="text-red-600">Ошибка: {err}</div>
