"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  slug: string;
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

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const selectionInitialized = useRef(false);
  const selectAllCheckbox = useRef<HTMLInputElement>(null);

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryType, setDeliveryType] = useState<"pickup" | "delivery">("pickup");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "KASPI_TRANSFER">("KASPI_TRANSFER");

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const sync = () => {
    const c = getCart();
    setCart(c);

    const keys = new Set(c.map((x) => x.id));
    setSelected((prev) => {
      return new Set([...prev].filter((key) => keys.has(key)));
    });

    if (c.length === 0) selectionInitialized.current = false;
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

        const loadedProducts = data.products || [];
        const loadedProductIds = new Set(loadedProducts.map((product) => product.id));
        const requestedProductIds = new Set(uniqueIds);
        const currentCart = getCart();
        const validCart = currentCart.filter((item) => {
          const productId = parseCartKey(item.id).productId;
          return !requestedProductIds.has(productId) || loadedProductIds.has(productId);
        });

        if (validCart.length !== currentCart.length) {
          writeCart(validCart);
        }

        setProducts(loadedProducts);
      } catch (e: any) {
        setErr(e?.message || "Не удалось загрузить товары");
        setProducts([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [idsKey, cart]);

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
  }, [products, idsKey, cart, productMap]);

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
          link: `/shop/${p.slug}`,
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

  useEffect(() => {
    const rowKeys = new Set(rows.map((row) => row.cartKey));

    setSelected((prev) => {
      if (!selectionInitialized.current && rowKeys.size > 0) {
        selectionInitialized.current = true;
        return rowKeys;
      }

      return new Set([...prev].filter((key) => rowKeys.has(key)));
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
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const partiallySelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllCheckbox.current) {
      selectAllCheckbox.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(rows.map((row) => row.cartKey)),
    );
    setShowForm(false);
  };

  const deleteSelected = () => {
    const keys = new Set(selectedRows.map((row) => row.cartKey));
    writeCart(getCart().filter((item) => !keys.has(item.id)));
    setSelected(new Set());
    setShowForm(false);
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
    if (!email.trim()) return setSubmitErr("Укажите email для ссылки на заказ и уведомлений");
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
          paymentMethod,
          cart: cartSelected,
        }),
      });

      const data = (await res.json()) as any;
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Не удалось создать заказ");
      }

      const orderNumber = String(data.orderNumber || "");

      cartSelected.forEach((it) => setQtyStorage(it.id, 0));

      setShowForm(false);
      setSelected(new Set());

      const accessToken = String(data.accessToken || "");
      router.push(`/checkout/success?order=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(accessToken)}`);
    } catch (e: any) {
      setSubmitErr(e?.message || "Ошибка оформления заказа");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-4 sm:space-y-6 sm:py-8">
      <div>
        <h1 className="text-3xl font-bold">Корзина</h1>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
          <span>
            Позиций: <strong className="font-semibold text-gray-700">{rows.length}</strong>
          </span>
          <span>
            Выбрано: <strong className="font-semibold text-gray-700">{selectedCount}</strong>
          </span>
          <span>
            К оплате:{" "}
            <strong className="font-semibold text-gray-700">
              {totalSelected.toLocaleString("ru-RU")} ₸
            </strong>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Загрузка…</div>
      ) : err ? (
        <div className="text-red-600">Ошибка: {err}</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500">Корзина пуста. Нажмите «Купить» в каталоге.</div>
      ) : (
        <>
          <div className="flex min-h-8 items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
              <input
                ref={selectAllCheckbox}
                type="checkbox"
                className="h-5 w-5"
                checked={allSelected}
                onChange={toggleAll}
              />
              Выбрать все
            </label>

            {selectedCount > 0 ? (
              <button
                type="button"
                className="text-sm font-semibold text-red-700 hover:underline"
                onClick={deleteSelected}
              >
                Удалить выбранное
              </button>
            ) : null}
          </div>

          <div className="space-y-3">
            {rows.map((r) => {
              const inStock = r.stock > 0;
              const plusDisabled = !inStock || r.qty >= r.stock;
              const checked = selected.has(r.cartKey);

              return (
                <div key={r.cartKey} className="rounded-2xl border p-4 shadow-sm">
                  <div className="grid grid-cols-[auto_64px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[auto_64px_minmax(0,1fr)_112px]">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={checked}
                      onChange={() => toggleOne(r.cartKey)}
                      aria-label="Выбрать позицию"
                    />

                    <img
                      src={r.image}
                      alt={r.title}
                      className="h-16 w-16 rounded-xl object-cover bg-gray-100"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="line-clamp-2 font-semibold leading-5">
                        <Link href={r.link} className="hover:underline">
                          {r.title}
                        </Link>
                      </div>
                      <div className="mt-1 text-sm leading-5 text-gray-500">
                        {r.brandOrCategory} •{" "}
                        <span className={inStock ? "text-emerald-700" : "text-gray-500"}>
                          {inStock ? `В наличии: ${r.stock}` : "Нет в наличии"}
                        </span>
                      </div>
                    </div>

                    <div className="hidden w-28 text-right font-semibold sm:block">
                      {r.unitPrice.toLocaleString("ru-RU")} ₸
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border hover:bg-gray-50"
                        onClick={() => setQtyStorage(r.cartKey, r.qty - 1, r.stock)}
                        aria-label={`Уменьшить количество «${r.title}»`}
                      >
                        −
                      </button>

                      <div className="w-8 text-center">{r.qty}</div>

                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border hover:bg-gray-50 disabled:opacity-50"
                        onClick={() => setQtyStorage(r.cartKey, r.qty + 1, r.stock)}
                        disabled={plusDisabled}
                        aria-label={`Увеличить количество «${r.title}»`}
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
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs text-gray-500">
                    Всего в корзине: {totalAll.toLocaleString("ru-RU")} ₸
                  </div>
                  <div className="mt-1 text-lg font-bold">
                    К оплате: {totalSelected.toLocaleString("ru-RU")} ₸
                  </div>
                </div>
                <button
                  type="button"
                  className="btn w-full disabled:opacity-50 sm:w-auto"
                  onClick={openForm}
                  disabled={!canOpenForm}
                >
                  Перейти к оформлению
                </button>
              </div>
              {!canOpenForm ? (
                <div className="mt-2 text-xs text-gray-500">
                  Отметьте хотя бы одну позицию для оформления.
                </div>
              ) : null}
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
                  <div className="text-sm text-gray-600">Email для ссылки на заказ и уведомлений *</div>
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

              <div className="text-sm font-semibold pt-1">Оплата</div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                После подтверждения заказа менеджер отправит реквизиты для перевода на Kaspi. Сборка и отправка начнутся после ручной проверки оплаты.
              </div>

              <label className="space-y-1">
                <div className="text-sm text-gray-600">Комментарий (необязательно)</div>
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
                На email придёт защищённая ссылка на страницу заказа. После перевода нажмите там «Я оплатил».
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
