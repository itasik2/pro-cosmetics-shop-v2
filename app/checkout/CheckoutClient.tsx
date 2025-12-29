"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { clampCartToStock, getCart, setQty as setQtyStorage, writeCart } from "@/lib/cartStorage";

type CartItem = { id: string; qty: number };

type Product = {
  id: string;
  name: string;
  image: string;
  price: number; // KZT, Int
  stock: number;
  category: string;
  brand?: { name: string } | null;
};

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

  // ключ только по набору ID, чтобы не дергать API при изменении qty
  const idsKey = useMemo(() => {
    const ids = cart.map((x) => x.id).filter(Boolean);
    const unique = Array.from(new Set(ids)).sort();
    return unique.join("|");
  }, [cart]);

  // загрузка товаров только когда меняется набор ID
  useEffect(() => {
    (async () => {
      setErr(null);

      const ids = cart.map((x) => x.id).filter(Boolean);
      const uniqueIds = Array.from(new Set(ids)).slice(0, 100);

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

  // вариант A: если qty > stock — автоматически режем до stock
  useEffect(() => {
    if (products.length === 0) return;
    const stockMap = new Map(products.map((p) => [p.id, p.stock]));
    clampCartToStock(stockMap);
  }, [products]);

  const total = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p]));
    return cart.reduce((sum, item) => {
      const p = map.get(item.id);
      if (!p) return sum;
      return sum + p.price * item.qty;
    }, 0);
  }, [cart, products]);

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
          {products.map((p) => {
            const item = cart.find((x) => x.id === p.id);
            const qty = item?.qty ?? 0;
            const inStock = p.stock > 0;

            return (
              <div key={p.id} className="rounded-2xl border p-4 shadow-sm">
                <div className="flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.image}
                    alt={p.name}
                    className="h-16 w-16 rounded-xl object-cover bg-gray-100"
                  />

                  <div className="flex-1">
                    <div className="font-semibold">
                      <Link href={`/shop/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </div>
                    <div className="text-sm text-gray-500">
                      {p.brand?.name ?? p.category} •{" "}
                      <span className={inStock ? "text-emerald-700" : "text-gray-500"}>
                        {inStock ? `В наличии: ${p.stock}` : "Нет в наличии"}
                      </span>
                    </div>
                  </div>

                  <div className="font-semibold w-28 text-right">
                    {p.price.toLocaleString("ru-RU")} ₸
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded-xl border hover:bg-gray-50"
                      onClick={() => setQtyStorage(p.id, qty - 1, p.stock)}
                    >
                      −
                    </button>

                    <div className="w-10 text-center">{qty}</div>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-xl border hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => setQtyStorage(p.id, qty + 1, p.stock)}
                      disabled={!inStock || qty >= p.stock}
                    >
                      +
                    </button>
                  </div>

                  <div className="font-semibold">
                    {(p.price * qty).toLocaleString("ru-RU")} ₸
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
