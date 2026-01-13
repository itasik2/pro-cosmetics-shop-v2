"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clampCartToStock,
  getCart,
  setQty as setQtyStorage,
  writeCart,
  parseCartKey,
  type CartItem,
} from "@/lib/cartStorage";

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
  const router = useRouter();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // selection (НЕ сохраняем в localStorage — чтобы не было циклов и чтобы F5 сбрасывал)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // form visibility
  const [showForm, setShowForm] = useState(false);

  // form
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryType, setDeliveryType] = useState<"pickup" | "delivery">("pickup");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const sync = () => {
    const c = getCart();
    setCart(c);
    // при изменении корзины — оставляем только существующие ключи;
    // если выбор пустой, выбираем всё (MVP удобство)
    const keys = c.map((x) => x.id);
    setSelected((prev) => {
      const kept = new Set([...prev].filter((k) => keys.includes(k)));
      if (kept.size === 0 && keys.length > 0) keys.forEach((k) => kept.add(k));
      return kept;
    });
  };

  useEffect(() => {
    sync();
    const onSync = () => sync();
    window.addEventListener("storage", onSync);
    window.addEventListener("storage-sync", onSync);
    return () => {
      window.removeEventListener("storage", onSync);
      window.removeEventListener("storage-sync", onSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const idsKey = useMemo(() => {
    const productIds = cart.map((x) => parseCartKey(x.id).productId).filter(Boolean);
    const unique = Array.from(new Set(productIds)).sort();
    return unique.join("|");
  }, [cart]);

  useEffect(() => {
    (async () => {
      setErr(null);

      const productIds = cart.map((x) => parseCartKey(x.id).productId).filter(Boolean);
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

  // если rows изменились (например загрузились товары), и выбор пустой — выберем всё
  useEffect(() => {
    if (rows.length === 0) return;
    setSelected((prev) => {
      if (prev.size > 0) return prev;
      return new Set(rows.map((r) => r.cartKey));
    });
  }, [rows]);

  const totalAll = useMemo(
    () => rows.reduce((sum, r) => sum + r.unitPrice * r.qty, 0),
    [rows],
  );

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.cartKey)),
    [rows, selected],
  );

  const totalSelected = useMemo(
    () => selectedRows.reduce((sum, r) => sum + r.unitPrice * r.qty, 0),
    [selectedRows],
  );

  const selectedCount = selectedRows.length;

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(rows.map((r) => r.cartKey)));
  };

  const clearSelection = () => {
    setSelected(new Set());
    setShowForm(false);
  };

  const deleteSelected = () => {
    const keys = Array.from(selected);
    keys.forEach((k) => setQtyStorage(k, 0));
    setSelected(new Set());
    setShowForm(false);
    sync();
  };

  const clearCart = () => {
    writeCart([]);
    setSelected(new Set());
    setShowForm(false);
    sync();
  };

  const canOpenForm = selectedCount > 0 && totalSelected > 0;

  const openForm = () => {
    if (!canOpenForm) return;
    setSubmitErr(null);
    setShowForm(true);
  };

  async function submitOrder() {
    if (!canOpenForm || submitting) return;

    setSubmitErr(null);

    const name = customerName.trim();
    const ph = phone.trim();
    const addr = address.trim();

    if (name.length < 2) return setSubmitErr("Укажите имя");
    if (ph.length < 6) return setSubmitErr("Укажите телефон");
    if (deliveryType === "delivery" && addr.length < 5) {
      return setSubmitErr("Укажите адрес доставки");
    }

    const cartSelected = selectedRows.map((r) => ({ id: r.cartKey, qty: r.qty }));

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          phone: ph,
          email: email.trim(),
          deliveryType,
          address: addr,
          comment: comment.trim(),
          cart: cartSelected, // только выбранные позиции
        }),
      });

      const data = (await res.json()) as any;
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Не удалось создать заказ");
      }

      const orderNumber = String(data.orderNumber || "");

      // удаляем из корзины только выбранные позиции
      cartSelected.forEach((it) => setQtyStorage(it.id, 0));

      setShowForm(false);
      setSelected(new Set());

      router.push(`/checkout/success?order=${encodeURIComponent(orderNumber)}`);
    } catch (e: any) {
      setSubmitErr(e?.message || "Ошибка оформления заказа");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Корзина</h2>
          <div className="text-sm text-gray-500 mt-1">
            Позиций: {rows.length} • Выбрано: {selectedCount} • К оплате:{" "}
            {totalSelected.toLocaleString("ru-RU")} ₸
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
            onClick={clearCart}
            className="px-3 py-1 rounded-full text-sm border bg-white text-gray-700 hover:bg-gray-50"
            type="button"
          >
            Очистить всё
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Загрузка…</div>
      ) : err ? (
        <div className="text-red-600">Ошибка: {err}</div>
      ) : cart.length === 0 ? (
        <div className="text-sm text-gray-500">Корзина пустая. Нажмите “Купить” в каталоге.</div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-1 rounded-full text-sm border bg-white hover:bg-gray-50"
                onClick={selectAll}
              >
                Выбрать всё
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded-full text-sm border bg-white hover:bg-gray-50 disabled:opacity-50"
                onClick={clearSelection}
                disabled={selected.size === 0}
              >
                Снять выбор
              </button>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="px-3 py-1 rounded-full text-sm border bg-white hover:bg-gray-50 disabled:opacity-50"
                onClick={deleteSelected}
                disabled={selected.size === 0}
              >
                Удалить выбранное
              </button>

              <button
                type="button"
                className="px-3 py-1 rounded-full text-sm bg-black text-white disabled:opacity-50"
                onClick={openForm}
                disabled={!canOpenForm}
              >
                Оформить выбранное
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((r) => {
              const inStock = r.stock > 0;
              const plusDisabled = !inStock || r.qty >= r.stock;
              const checked = selected.has(r.cartKey);

              return (
                <div key={r.cartKey} className="rounded-2xl border p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={checked}
                      onChange={() => toggleOne(r.cartKey)}
                      aria-label="Выбрать позицию"
                    />

                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.image}
                      alt={r.title}
                      className="h-16 w-16 rounded-xl object-cover bg-gray-100"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">
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
          </div>

          {!showForm ? (
            <div className="rounded-2xl border p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-gray-600">
                  Всего в корзине:{" "}
                  <span className="font-semibold">{totalAll.toLocaleString("ru-RU")} ₸</span>
                  <span className="mx-2">•</span>
                  К оплате:{" "}
                  <span className="font-semibold">{totalSelected.toLocaleString("ru-RU")} ₸</span>
                </div>
                <button
                  type="button"
                  className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
                  onClick={openForm}
                  disabled={!canOpenForm}
                >
                  Оформить выбранное
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Выберите позиции, затем нажмите “Оформить выбранное”.
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border p-4 shadow-sm space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-lg font-bold">Оформление</div>
                  <div className="text-sm text-gray-500">
                    Выбрано: {selectedCount} • Итого: {totalSelected.toLocaleString("ru-RU")} ₸
                  </div>
                </div>

                <button
                  type="button"
                  className="px-3 py-1 rounded-full text-sm border bg-white hover:bg-gray-50"
                  onClick={() => {
                    setShowForm(false);
                    setSubmitErr(null);
                  }}
                >
                  Закрыть
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-sm text-gray-600">Имя *</div>
                  <input
                    className="w-full border rounded-xl px-3 py-2"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Ваше имя"
                  />
                </label>

                <label className="space-y-1">
                  <div className="text-sm text-gray-600">Телефон *</div>
                  <input
                    className="w-full border rounded-xl px-3 py-2"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 ..."
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <div className="text-sm text-gray-600">Email (опционально)</div>
                  <input
                    className="w-full border rounded-xl px-3 py-2"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                  />
                </label>
              </div>

              <div className="text-sm font-semibold pt-1">Доставка</div>
              <div className="flex gap-4">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={deliveryType === "pickup"}
                    onChange={() => setDeliveryType("pickup")}
                  />
                  <span>Самовывоз</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={deliveryType === "delivery"}
                    onChange={() => setDeliveryType("delivery")}
                  />
                  <span>Доставка</span>
                </label>
              </div>

              {deliveryType === "delivery" && (
                <label className="space-y-1">
                  <div className="text-sm text-gray-600">Адрес доставки *</div>
                  <input
                    className="w-full border rounded-xl px-3 py-2"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Город, улица, дом, квартира"
                  />
                </label>
              )}

              <label className="space-y-1">
                <div className="text-sm text-gray-600">Комментарий (опционально)</div>
                <textarea
                  className="w-full border rounded-xl px-3 py-2 min-h-[90px]"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Например: удобное время, уточнения…"
                />
              </label>

              {submitErr && <div className="text-red-600">{submitErr}</div>}

              <div className="flex items-center justify-between pt-1">
                <div className="text-base font-bold">
                  К оплате: {totalSelected.toLocaleString("ru-RU")} ₸
                </div>

                <button
                  type="button"
                  className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
                  onClick={submitOrder}
                  disabled={!canOpenForm || submitting}
                >
                  {submitting ? "Оформляем…" : "Оформить заказ"}
                </button>
              </div>

              <div className="text-xs text-gray-500">
                Оплата на первом этапе: при получении / перевод (уточняется менеджером).
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
