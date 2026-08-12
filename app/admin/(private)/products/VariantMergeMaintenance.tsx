"use client";

import Link from "next/link";
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
  enrichmentProposalStatus: "PENDING" | "APPLIED" | null;
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

function discoveryErrorText(value: string) {
  const messages: Record<string, string> = {
    product_page_not_found:
      "Товар не найден ни на официальном сайте, ни у проверяемых продавцов.",
    product_page_not_found_after_stale_source:
      "Старый адрес больше не работает, новая карточка не найдена ни на официальном сайте, ни у проверяемых продавцов.",
    official_page_not_found:
      "Официальная карточка не найдена, резервный поиск не был выполнен.",
    enrichment_proposal_exists:
      "Данные уже найдены и ожидают проверки во вкладке автозаполнения.",
    enrichment_already_running: "Поиск этого товара уже выполняется.",
    openai_not_configured: "Поиск не настроен: отсутствует ключ сервиса.",
    openai_timeout:
      "Поиск занял слишком много времени. Повторите попытку через минуту.",
    discovered_source_disabled:
      "Найденный источник отключён в настройках и не может быть использован.",
  };

  return messages[value] || value;
}

export default function VariantMergeMaintenance() {
  const [groups, setGroups] = useState<CandidateGroup[]>([]);
  const [canonicalIds, setCanonicalIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [proposalCreated, setProposalCreated] = useState(false);

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

  async function discover(product: CandidateProduct) {
    const key = `discover:${product.id}`;
    setBusyKey(key);
    setMessage(null);
    setProposalCreated(false);
    try {
      const response = await fetch(`/api/admin/enrichment/products/${product.id}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: "", discoverIfMissing: true }),
      });
      await readResponse(response);
      setMessage(`Для «${product.name}» создано предложение автозаполнения.`);
      setProposalCreated(true);
      await load();
      window.dispatchEvent(new Event("products-changed"));
    } catch (error) {
      const value = error instanceof Error ? error.message : String(error);
      setMessage(`Поиск данных не выполнен: ${discoveryErrorText(value)}`);
    } finally {
      setBusyKey(null);
    }
  }

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

    setBusyKey(`merge:${group.key}`);
    setMessage(null);
    setProposalCreated(false);
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
        `Объединено: «${String(data?.product?.name || group.title)}». Вариантов: ${Array.isArray(data?.product?.variants) ? data.product.variants.length : "—"}. Архивированные карточки скрыты.`,
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
    <section className="rounded-2xl border bg-white">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Дубли, которые можно объединить в варианты</h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {loading ? "…" : groups.length}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Откройте только когда нужно проверить группы, найти данные или объединить фасовки.
            </p>
          </div>
          <span className="shrink-0 text-sm text-gray-500 group-open:hidden">Развернуть ↓</span>
          <span className="hidden shrink-0 text-sm text-gray-500 group-open:inline">Свернуть ↑</span>
        </summary>

        <div className="space-y-4 border-t p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-3xl text-xs text-gray-500">
              Показываются товары одного бренда с одинаковым базовым названием и разными
              фасовками, включая старые карточки без поставщика. Отмеченная карточка останется
              основной.
            </p>
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
              <article key={group.key} className="space-y-3 rounded-xl border p-3">
                <div>
                  <div className="font-medium">{group.title}</div>
                  <div className="text-xs text-gray-500">
                    {group.brand} · {group.supplier || "без поставщика"} · карточек:{" "}
                    {group.products.length}
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {group.products.map((product) => {
                    const selected = canonicalIds[group.key] === product.id;
                    const discovering = busyKey === `discover:${product.id}`;

                    return (
                      <div
                        key={product.id}
                        className={`flex gap-3 rounded-xl border p-3 ${
                          selected ? "border-gray-500 bg-gray-100" : "bg-white"
                        }`}
                      >
                        <label className="mt-1 cursor-pointer">
                          <input
                            type="radio"
                            name={`canonical-${group.key}`}
                            checked={selected}
                            onChange={() =>
                              setCanonicalIds((current) => ({
                                ...current,
                                [group.key]: product.id,
                              }))
                            }
                          />
                          <span className="sr-only">Оставить основной карточкой</span>
                        </label>

                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={product.image}
                          alt=""
                          className="h-16 w-16 rounded-lg border bg-white object-contain"
                        />

                        <div className="min-w-0 flex-1 text-xs">
                          <div className="break-words text-sm font-medium">{product.name}</div>
                          <div className="mt-1 text-gray-600">
                            {product.label || "Без фасовки"} · {product.price.toLocaleString("ru-RU")} ₸ · остаток {product.stock}
                          </div>
                          <div className="mt-1 text-gray-500">SKU: {product.sku || "—"}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {product.isPublished && (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                Опубликован
                              </span>
                            )}
                            {product.appliedEnrichment ? (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                                Автозаполнение одобрено
                              </span>
                            ) : product.enrichmentProposalStatus === "PENDING" ? (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                                Данные найдены — ожидают проверки
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                                Данные не одобрены
                              </span>
                            )}
                            {product.variants.length > 0 && (
                              <span className="rounded-full bg-gray-100 px-2 py-0.5">
                                Вариантов: {product.variants.length}
                              </span>
                            )}
                          </div>

                          {!product.enrichmentProposalStatus && (
                            <button
                              type="button"
                              disabled={Boolean(busyKey)}
                              onClick={() => void discover(product)}
                              className="mt-2 rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                            >
                              {discovering ? "Поиск данных…" : "Найти данные"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                  <button
                    type="button"
                    disabled={Boolean(busyKey)}
                    onClick={() => void merge(group)}
                    className="rounded-xl bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {busyKey === `merge:${group.key}` ? "Объединение…" : "Объединить в варианты"}
                  </button>
                  <span className="text-xs text-gray-500">
                    Остальные карточки будут архивированы как MERGED и скрыты из рабочих списков.
                  </span>
                </div>
              </article>
            ))}
          </div>

          {message && (
            <div className="rounded-xl border bg-gray-50 px-3 py-2 text-sm">
              {message}
              {proposalCreated && (
                <div className="mt-2">
                  <Link
                    href="/admin/price-workflow?step=enrichment"
                    className="font-medium underline underline-offset-2"
                  >
                    Перейти к проверке фото и описания →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
