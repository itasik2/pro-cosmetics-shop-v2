"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function readCart(): CartItem[] {
  try {
    const raw = localStorage.getItem("cart");
    const arr = raw ? (JSON.parse(raw) as CartItem[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeCart(items: CartItem[]) {
  localStorage.setItem("cart", JSON.stringify(items));
  window.dispatchEvent(new Event("storage-sync"));
}

export default function CheckoutClient() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sync = () => setCart(readCart());

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

  useEffect(() => {
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        const ids = cart.map((x) => x.id);
        const res = await fetch("/api/products/by-ids", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
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
  }, [cart]);

  const total = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p]));
    return cart.reduce((sum, item) => {
      const p = map.get(item.id);
      if (!p) return sum;
      return sum + p.price * item.qty;
    }, 0);
  }, [cart, products]);

  const setQty = (id: string, qty: number) => {
    const next = cart
      .map((x) => (x.id === id ? { ...x, qty } : x))
      .filter((x) => x.qty > 0);
    writeCart(next);
    sync();
  };

  const clear = () => {
    writeCart([]);
    sync();
  };

  // (опционально) убрать из корзины товары, которых больше нет в БД
  useEffect(() => {
    if (cart.length === 0) return;
    if (products.length === 0) return;
    const existing = new Set(products.map((p) => p.id));
    const next = cart.filter((x) => existing.has(x.id));
    if (next.length !== cart.length) {
      writeCart(next);
      sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

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
                      onClick={() => setQty(p.id, Math.max(0, qty - 1))}
                    >
                      −
                    </button>
                    <div className="w-10 text-center">{qty}</div>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-xl border hover:bg-gray-50"
                      onClick={() => setQty(p.id, qty + 1)}
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
