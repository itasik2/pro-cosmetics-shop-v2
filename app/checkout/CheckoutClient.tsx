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

type CartItem = { id: string; qty: number };

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
  price: number;
  stock: number;
  category: string;
  brand?: { name: string } | null;
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

  const idsKey = useMemo(() => {
    const productIds = cart
      .map((x) => parseCartKey(x.id).productId)
      .filter(Boolean);
    const unique = Array.from(new Set(productIds)).sort();
    return unique.join("|");
  }, [cart]);

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

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

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
        stockMap.set(it.id, p.stock);
      }
    }

    clampCartToStock(stockMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, idsKey]);

  const rows = useMemo(() => {
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
      ) : cart.length === 0 ? (
        <div className="text-sm text-gray-500">
          Корзина пустая. Нажмите “Купить” в каталоге.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const inStock = r.stock > 0;
            const plusDisabled = !inStock || r.qty >= r.stock;

            return (
              <div key={r.cartKey} className="rounded-2xl border p-4 shadow-sm">
                <div className="flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.image}
                    alt={r.title}
                    className="h-16 w-16 rounded-xl object-cover bg-gray-100"
                  />

                  <div className="flex-1">
                    <div className="font-semibold">
                      <Link href={r.link} className="hover:underline">
                        {r.title}
                      </Link>
                    </div>
                    <div className="text-sm text-gray-500">
                      {r.brandOrCategory} •{" "}
                      <span className={inStock ? "text-emerald-700" : "text-gray-500"}>
                        {inStock ? `В наличии: ${r.stock}` : "Нет в наличии"}
                      </span>
                    </div>
                  </div>

                  <div className="font-semibold w-28 text-right">
                    {r.unitPrice.toLocaleString("ru-RU")} ₸
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded-xl border hover:bg-gray-50"
                      onClick={() => setQtyStorage(r.cartKey, r.qty - 1, r.stock)}
                    >
                      −
                    </button>

                    <div className="w-10 text-center">{r.qty}</div>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-xl border hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => setQtyStorage(r.cartKey, r.qty + 1, r.stock)}
                      disabled={plusDisabled}
                    >
                      +
                    </button>
                  </div>

                  <div className="font-semibold">
                    {(r.unitPrice * r.qty).toLocaleString("ru-RU")} ₸
                  </div>
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-3 pt-2">
            <div className="text-base font-bold">
              Итого: {total.toLocaleString("ru-RU")} ₸
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
              onClick={() => alert("Оплата будет подключена после Stripe Webhooks")}
            >
              Перейти к оплате
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
