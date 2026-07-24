"use client";

import { useEffect, useState } from "react";

type Product = {
  id: string;
  name: string;
  description: string;
  image: string;
  category: string;
  price: number;
  isPublished: boolean;
  brand?: { name: string } | null;
  supplier?: { name: string } | null;
};

export default function DraftProductsPublisher() {
  const [items, setItems] = useState<Product[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/products", { cache: "no-store" });
    if (!response.ok) return;
    const rows = (await response.json()) as Product[];
    setItems(rows.filter((product) => !product.isPublished));
  }

  useEffect(() => {
    void load();
  }, []);

  async function publish(product: Product) {
    setBusyId(product.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data.message || data.error || response.status));
      }
      setMessage(`Товар «${product.name}» опубликован в каталоге.`);
      await load();
      window.dispatchEvent(new Event("products-changed"));
    } catch (error) {
      setMessage(
        `Публикация не выполнена: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Черновики для публикации</h2>
        <p className="mt-1 text-xs text-gray-500">
          Перед публикацией должны быть заполнены бренд, описание, настоящее фото,
          категория и цена. Остаток может быть нулевым, тогда товар будет показан как
          отсутствующий.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {items.map((product) => (
          <div
            key={product.id}
            className="rounded-xl border p-3 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="font-medium break-words">{product.name}</div>
              <div className="text-xs text-gray-500">
                {product.brand?.name || "Без бренда"} • {product.supplier?.name || "Без поставщика"} •{" "}
                {Number(product.price).toLocaleString("ru-RU")} ₸
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 px-3 py-2 rounded-xl bg-black text-white disabled:opacity-50"
              disabled={busyId === product.id}
              onClick={() => publish(product)}
            >
              {busyId === product.id ? "Публикация…" : "Опубликовать"}
            </button>
          </div>
        ))}
      </div>

      {message && <div className="text-sm">{message}</div>}
    </section>
  );
}
