"use client";

import { useEffect, useMemo, useState } from "react";

type Variant = {
  id: string;
  label: string;
  stock: number;
  sku?: string;
};

type Product = {
  id: string;
  name: string;
  stock: number;
  variants?: unknown;
  brand?: { name: string } | null;
};

type StockDraft = Record<string, Record<string, string>>;

function normalizeVariants(value: unknown): Variant[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((raw) => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const id = String(row.id || "").trim();
      const label = String(row.label || "").trim();
      if (!id || !label) return null;

      return {
        id,
        label,
        stock: Math.max(0, Math.trunc(Number(row.stock) || 0)),
        sku: String(row.sku || "").trim() || undefined,
      };
    })
    .filter(Boolean) as Variant[];
}

function normalizeSearch(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function VariantStockManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [drafts, setDrafts] = useState<StockDraft>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/products", { cache: "no-store" });
    if (!response.ok) return;

    const rows = (await response.json()) as Product[];
    const withVariants = rows.filter((product) => normalizeVariants(product.variants).length > 0);
    setProducts(withVariants);
    setDrafts((current) => {
      const next: StockDraft = { ...current };
      for (const product of withVariants) {
        if (next[product.id]) continue;
        next[product.id] = Object.fromEntries(
          normalizeVariants(product.variants).map((variant) => [variant.id, String(variant.stock)]),
        );
      }
      return next;
    });
  }

  useEffect(() => {
    void load();

    const savedSearch = window.sessionStorage.getItem("admin-product-search") || "";
    setSearchQuery(savedSearch);

    const onProductsChanged = () => void load();
    const onSearch = (event: Event) => {
      setSearchQuery((event as CustomEvent<string>).detail || "");
    };

    window.addEventListener("products-changed", onProductsChanged);
    window.addEventListener("admin-product-search", onSearch);
    return () => {
      window.removeEventListener("products-changed", onProductsChanged);
      window.removeEventListener("admin-product-search", onSearch);
    };
    // load is intentionally local to this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredProducts = useMemo(() => {
    const query = normalizeSearch(searchQuery);
    if (!query) return products;
    const tokens = query.split(" ");

    return products.filter((product) => {
      const variants = normalizeVariants(product.variants);
      const haystack = normalizeSearch(
        [
          product.name,
          product.brand?.name,
          ...variants.flatMap((variant) => [variant.label, variant.sku]),
        ]
          .filter(Boolean)
          .join(" "),
      );
      return tokens.every((token) => haystack.includes(token));
    });
  }, [products, searchQuery]);

  function setStock(productId: string, variantId: string, value: string) {
    const cleaned = value.replace(/[^\d]/g, "");
    setDrafts((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] || {}),
        [variantId]: cleaned,
      },
    }));
  }

  async function save(product: Product) {
    const variants = normalizeVariants(product.variants);
    if (variants.length === 0 || busyId) return;

    setBusyId(product.id);
    setMessage(null);
    try {
      const stocks = variants.map((variant) => ({
        variantId: variant.id,
        stock: Math.max(
          0,
          Math.trunc(Number(drafts[product.id]?.[variant.id] ?? variant.stock) || 0),
        ),
      }));

      const response = await fetch(`/api/products/${encodeURIComponent(product.id)}/variant-stock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        stock?: number;
      };
      if (!response.ok) throw new Error(data.error || "save_failed");

      setMessage(
        `Остатки «${product.name}» сохранены. Всего: ${Math.max(0, Math.trunc(Number(data.stock) || 0))} шт.`,
      );
      await load();
      window.dispatchEvent(new Event("products-changed"));
    } catch (error) {
      setMessage(
        `Не удалось сохранить остатки: ${error instanceof Error ? error.message : "save_failed"}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  if (products.length === 0) return null;

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Остатки вариантов</h2>
          <p className="mt-1 text-sm text-gray-500">
            Изменяйте количество каждого объёма отдельно. Общий остаток товара считается автоматически.
          </p>
        </div>
        <span className="text-xs text-gray-500">Товаров с вариантами: {filteredProducts.length}</span>
      </div>

      {message ? (
        <div className="mt-3 rounded-xl border bg-gray-50 px-3 py-2 text-sm">{message}</div>
      ) : null}

      <div className="mt-4 space-y-3">
        {filteredProducts.map((product) => {
          const variants = normalizeVariants(product.variants);
          const draft = drafts[product.id] || {};
          const total = variants.reduce(
            (sum, variant) =>
              sum + Math.max(0, Math.trunc(Number(draft[variant.id] ?? variant.stock) || 0)),
            0,
          );

          return (
            <details key={product.id} className="rounded-xl border">
              <summary className="cursor-pointer list-none px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{product.name}</div>
                    <div className="text-xs text-gray-500">
                      {product.brand?.name || "Без бренда"} · {variants.length} вариантов
                    </div>
                  </div>
                  <div className="text-sm font-semibold">Всего: {total} шт.</div>
                </div>
              </summary>

              <div className="border-t p-3">
                <div className="space-y-2">
                  {variants.map((variant) => (
                    <div
                      key={variant.id}
                      className="grid grid-cols-1 gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-end"
                    >
                      <div>
                        <div className="text-sm font-medium">{variant.label}</div>
                        {variant.sku ? (
                          <div className="mt-0.5 text-xs text-gray-500">SKU {variant.sku}</div>
                        ) : null}
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-600">
                          Количество, шт.
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          className="w-full rounded-xl border bg-white px-3 py-2"
                          value={draft[variant.id] ?? String(variant.stock)}
                          onChange={(event) =>
                            setStock(product.id, variant.id, event.target.value)
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-gray-600">
                    Общий остаток после сохранения: <strong>{total} шт.</strong>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={busyId === product.id}
                    onClick={() => save(product)}
                  >
                    {busyId === product.id ? "Сохраняем…" : "Сохранить остатки"}
                  </button>
                </div>
              </div>
            </details>
          );
        })}

        {filteredProducts.length === 0 ? (
          <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
            По текущему поиску товаров с вариантами нет.
          </div>
        ) : null}
      </div>
    </section>
  );
}
