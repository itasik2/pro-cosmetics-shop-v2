"use client";

import { useEffect, useMemo, useState } from "react";

type Product = {
  id: string;
  name: string;
  description: string;
  image: string;
  category: string;
  price: number;
  stock: number;
  isPublished: boolean;
  brand?: { name: string } | null;
  supplier?: { name: string } | null;
  enrichmentProposals: Array<{
    id: string;
    status: string;
    appliedAt: string | null;
  }>;
};

function parseStock(value: string) {
  const stock = Number(value);
  return Number.isInteger(stock) && stock >= 0 ? stock : null;
}

export default function DraftProductsPublisher() {
  const [items, setItems] = useState<Product[]>([]);
  const [stockValues, setStockValues] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/products?publicationQueue=1", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data)) {
        throw new Error(
          String(data?.message || data?.error || "Не удалось загрузить очередь публикации"),
        );
      }

      const rows = data as Product[];
      setItems(rows);
      setStockValues((current) => {
        const next: Record<string, string> = {};
        for (const product of rows) {
          next[product.id] = current[product.id] ?? String(product.stock);
        }
        return next;
      });
      setSelectedIds((current) => {
        const active = new Set(rows.map((product) => product.id));
        return current.filter((id) => active.has(id));
      });
    } catch (error) {
      setSuccess(null);
      setErrors({
        queue: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  function stockFor(product: Product) {
    const value = stockValues[product.id] ?? String(product.stock);
    const stock = parseStock(value);
    if (stock === null) {
      setErrors((current) => ({
        ...current,
        [product.id]: "Количество должно быть целым числом от 0 и выше.",
      }));
    }
    return stock;
  }

  function toggleSelected(productId: string) {
    setSelectedIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  async function patchProduct(product: Product, action: "stock" | "publish") {
    const stock = stockFor(product);
    if (stock === null) return;

    const key = `${product.id}:${action}`;
    setBusyKey(key);
    setSuccess(null);
    setErrors((current) => ({ ...current, [product.id]: "" }));

    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "publish" ? { isPublished: true, stock } : { stock },
        ),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data.message || data.error || response.status));
      }

      if (action === "publish") {
        setSuccess(`Товар «${product.name}» опубликован в каталоге.`);
        setSelectedIds((current) => current.filter((id) => id !== product.id));
        await load();
        window.dispatchEvent(new Event("products-changed"));
      } else {
        setItems((current) =>
          current.map((item) =>
            item.id === product.id ? { ...item, stock } : item,
          ),
        );
        setSuccess(`Количество товара «${product.name}» сохранено: ${stock}.`);
      }
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [product.id]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusyKey(null);
    }
  }

  async function publishSelected() {
    if (selectedIds.length === 0 || busyKey) return;

    const selectedProducts = items.filter((product) => selectedSet.has(product.id));
    const prepared = selectedProducts.map((product) => ({
      product,
      stock: parseStock(stockValues[product.id] ?? String(product.stock)),
    }));
    const invalid = prepared.filter((item) => item.stock === null);

    if (invalid.length > 0) {
      setErrors((current) => {
        const next = { ...current };
        for (const item of invalid) {
          next[item.product.id] = "Количество должно быть целым числом от 0 и выше.";
        }
        return next;
      });
      setSuccess(null);
      return;
    }

    if (!confirm(`Опубликовать выбранные товары: ${prepared.length}?`)) return;

    setBusyKey("bulk:publish");
    setSuccess(null);
    setErrors((current) => ({ ...current, bulk: "" }));

    const failed: Array<{ id: string; name: string; message: string }> = [];
    let published = 0;

    for (const item of prepared) {
      try {
        const response = await fetch(`/api/products/${item.product.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPublished: true, stock: item.stock }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(String(data.message || data.error || response.status));
        }
        published += 1;
      } catch (error) {
        failed.push({
          id: item.product.id,
          name: item.product.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    setErrors((current) => {
      const next = { ...current };
      for (const item of failed) next[item.id] = item.message;
      next.bulk = failed.length
        ? `Не опубликовано: ${failed.map((item) => item.name).join(", ")}.`
        : "";
      return next;
    });
    setSelectedIds(failed.map((item) => item.id));
    setSuccess(
      failed.length
        ? `Опубликовано ${published} из ${prepared.length}. Ошибочные товары оставлены выбранными.`
        : `Опубликовано товаров: ${published}.`,
    );
    setBusyKey(null);
    await load();
    window.dispatchEvent(new Event("products-changed"));
  }

  return (
    <section className="rounded-2xl border bg-white">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Черновики для публикации</h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {loading ? "…" : items.length}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Готовые после одобрения товары. Разверните блок только когда нужна публикация.
            </p>
          </div>
          <span className="shrink-0 text-sm text-gray-500 group-open:hidden">Развернуть ↓</span>
          <span className="hidden shrink-0 text-sm text-gray-500 group-open:inline">Свернуть ↑</span>
        </summary>

        <div className="space-y-4 border-t p-4">
          <p className="text-xs text-gray-500">
            Можно опубликовать один товар отдельно либо выбрать несколько и опубликовать их одной кнопкой.
          </p>

      {!loading && items.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50"
              disabled={Boolean(busyKey)}
              onClick={() => setSelectedIds(items.map((product) => product.id))}
            >
              Выбрать все
            </button>
            <button
              type="button"
              className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              disabled={selectedIds.length === 0 || Boolean(busyKey)}
              onClick={() => setSelectedIds([])}
            >
              Снять выбор
            </button>
            <span className="text-sm text-gray-600">
              Выбрано: {selectedIds.length} из {items.length}
              {allSelected ? " · все" : ""}
            </span>
          </div>

          <button
            type="button"
            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={selectedIds.length === 0 || Boolean(busyKey)}
            onClick={() => void publishSelected()}
          >
            {busyKey === "bulk:publish"
              ? "Публикация…"
              : `Опубликовать выбранные${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Загрузка очереди…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
          Готовых товаров пока нет. Сначала примените фото и описание полностью на
          шаге «Фото, описание и количество».
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((product) => {
            const approvalDate = product.enrichmentProposals[0]?.appliedAt;
            const stockBusy = busyKey === `${product.id}:stock`;
            const publishBusy = busyKey === `${product.id}:publish`;
            const selected = selectedSet.has(product.id);

            return (
              <div
                key={product.id}
                className={`rounded-xl border p-3 space-y-3 ${selected ? "border-black ring-1 ring-black" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <label className="mt-1 flex shrink-0 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={Boolean(busyKey)}
                      onChange={() => toggleSelected(product.id)}
                      className="h-5 w-5"
                      aria-label={`Выбрать ${product.name}`}
                    />
                  </label>
                  <img
                    src={product.image}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded-lg border object-contain bg-white"
                  />
                  <div className="min-w-0">
                    <div className="font-medium break-words">{product.name}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {product.brand?.name || "Без бренда"} •{" "}
                      {product.supplier?.name || "Без поставщика"} •{" "}
                      {Number(product.price).toLocaleString("ru-RU")} ₸
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">
                      Фото и описание одобрены
                      {approvalDate
                        ? ` · ${new Date(approvalDate).toLocaleString("ru-RU")}`
                        : ""}
                    </div>
                  </div>
                </div>

                <label className="block text-sm">
                  <span className="block mb-1 text-gray-600">Количество на складе</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={stockValues[product.id] ?? String(product.stock)}
                    onChange={(event) =>
                      setStockValues((current) => ({
                        ...current,
                        [product.id]: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border px-3 py-2"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-3 py-2 rounded-xl border disabled:opacity-50"
                    disabled={Boolean(busyKey)}
                    onClick={() => void patchProduct(product, "stock")}
                  >
                    {stockBusy ? "Сохранение…" : "Сохранить количество"}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-xl bg-black text-white disabled:opacity-50"
                    disabled={Boolean(busyKey)}
                    onClick={() => void patchProduct(product, "publish")}
                  >
                    {publishBusy ? "Публикация…" : "Опубликовать"}
                  </button>
                </div>

                {errors[product.id] && (
                  <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">
                    {errors[product.id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {errors.queue && (
        <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">
          {errors.queue}
        </div>
      )}
      {errors.bulk && (
        <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">
          {errors.bulk}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">
          {success}
        </div>
      )}
        </div>
      </details>
    </section>
  );
}
