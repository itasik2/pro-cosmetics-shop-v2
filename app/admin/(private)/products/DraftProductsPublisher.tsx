"use client";

import { useEffect, useState } from "react";

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

  async function patchProduct(
    product: Product,
    action: "stock" | "publish",
  ) {
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
          action === "publish"
            ? { isPublished: true, stock }
            : { stock },
        ),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data.message || data.error || response.status));
      }

      if (action === "publish") {
        setSuccess(`Товар «${product.name}» опубликован в каталоге.`);
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
        [product.id]:
          error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="rounded-2xl border p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Черновики для публикации</h2>
        <p className="mt-1 text-xs text-gray-500">
          Здесь показываются только товары, для которых предложение во вкладке
          «Автозаполнение» было одобрено и применено. Перед публикацией укажите
          фактическое количество на складе.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Загрузка очереди…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
          Готовых товаров пока нет. Сначала примените предложение во вкладке
          «Автозаполнение».
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((product) => {
            const approvalDate = product.enrichmentProposals[0]?.appliedAt;
            const stockBusy = busyKey === `${product.id}:stock`;
            const publishBusy = busyKey === `${product.id}:publish`;

            return (
              <div key={product.id} className="rounded-xl border p-3 space-y-3">
                <div className="flex gap-3">
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
                      Автозаполнение одобрено
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
      {success && (
        <div className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">
          {success}
        </div>
      )}
    </section>
  );
}
