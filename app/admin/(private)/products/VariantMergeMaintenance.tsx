"use client";

import { useEffect, useState } from "react";

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
};

type CandidateProduct = {
  id: string;
  name: string;
  sku: string | null;
  label: string;
  price: number;
  stock: number;
  image: string;
  isPublished: boolean;
  appliedEnrichment: boolean;
  variants: Variant[];
};

type CandidateGroup = {
  key: string;
  title: string;
  supplier: string;
  brand: string;
  suggestedCanonicalId: string;
  products: CandidateProduct[];
};

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.message || data?.error || response.status));
  }
  return data;
}

export default function VariantMergeMaintenance() {
  const [groups, setGroups] = useState<CandidateGroup[]>([]);
  const [canonicalIds, setCanonicalIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/products/variant-merge", { cache: "no-store" });
      const rows = (await readResponse(response)) as CandidateGroup[];
      setGroups(rows);
      setCanonicalIds((current) => {
        const next: Record<string, string> = {};
        for (const group of rows) {
          next[group.key] = current[group.key] || group.suggestedCanonicalId;
        }
        return next;
      });
    } catch (error) {
      setMessage(`Не удалось найти дубли: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function merge(group: CandidateGroup) {
    const canonicalId = canonicalIds[group.key] || group.suggestedCanonicalId;
    const canonical = group.products.find((product) => product.id === canonicalId);
    if (!canonical) return;

    if (
      !confirm(
        `Объединить ${group.products.length} карточки «${group.title}» в одну с вариантами? Основной будет «${canonical.name}».`,
      )
    ) {
      return;
    }

    setBusyKey(group.key);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/products/variant-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalId,
          productIds: group.products.map((product) => product.id),
        }),
      });
      const data = await readResponse(response);
      setMessage(
        `Объединено: «${String(data?.product?.name || group.title)}». Вариантов: ${Array.isArray(data?.product?.variants) ? data.product.variants.length : "—"}.`,
      );
      await load();
      window.dispatchEvent(new Event("products-changed"));
    } catch (error) {
      setMessage(`Объединение не выполнено: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="rounded-2xl border bg-white p-4 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold">Дубли, которые можно объединить в варианты</h2>
          <p className="mt-1 max-w-3xl text-xs text-gray-500">
            Показываются только товары одного поставщика и бренда с одинаковым базовым названием,
            но разными фасовками. Перед объединением проверьте список.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || Boolean(busyKey)}
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Поиск…" : "Обновить"}
        </button>
      </div>

      {!loading && groups.length === 0 && (
        <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
          Подходящих дублей не найдено.
        </div>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <article key={group.key} className="rounded-xl border p-3 space-y-3">
            <div>
              <div className="font-medium">{group.title}</div>
              <div className="text-xs text-gray-500">
                {group.brand} · {group.supplier} · карточек: {group.products.length}
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {group.products.map((product) => (
                <label
                  key={product.id}
                  className={`flex gap-3 rounded-xl border p-3 cursor-pointer ${
                    canonicalIds[group.key] === product.id ? "bg-gray-100 border-gray-500" : "bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name={`canonical-${group.key}`}
                    checked={canonicalIds[group.key] === product.id}
                    onChange={() =>
                      setCanonicalIds((current) => ({ ...current, [group.key]: product.id }))
                    }
                    className="mt-1"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={product.image}
                    alt=""
                    className="h-16 w-16 rounded-lg border bg-white object-contain"
                  />
                  <div className="min-w-0 text-xs">
                    <div className="font-medium text-sm break-words">{product.name}</div>
                    <div className="mt-1 text-gray-600">
                      {product.label || "Без фасовки"} · {product.price.toLocaleString("ru-RU")} ₸ · остаток {product.stock}
                    </div>
                    <div className="mt-1 text-gray-500">SKU: {product.sku || "—"}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {product.isPublished && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Опубликован</span>}
                      {product.appliedEnrichment && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">Автозаполнение одобрено</span>}
                      {product.variants.length > 0 && <span className="rounded-full bg-gray-100 px-2 py-0.5">Вариантов: {product.variants.length}</span>}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              <button
                type="button"
                disabled={Boolean(busyKey)}
                onClick={() => void merge(group)}
                className="rounded-xl bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {busyKey === group.key ? "Объединение…" : "Объединить в варианты"}
              </button>
              <span className="text-xs text-gray-500">
                Отмеченная карточка останется основной, остальные будут архивированы и скрыты из каталога.
              </span>
            </div>
          </article>
        ))}
      </div>

      {message && <div className="rounded-xl border bg-gray-50 px-3 py-2 text-sm">{message}</div>}
    </section>
  );
}
