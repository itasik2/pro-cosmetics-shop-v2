"use client";

import { useEffect, useMemo, useState } from "react";

type Product = {
  id: string;
  name: string;
  supplierSku: string | null;
  enrichmentStatus: string;
  brand: { id: string; name: string } | null;
  supplier: { id: string; name: string; slug: string } | null;
  enrichmentJobs: Array<{
    id: string;
    status: string;
    error: string | null;
    createdAt: string;
  }>;
  enrichmentProposals: Array<{
    id: string;
    confidence: number;
    createdAt: string;
  }>;
};

type ResultState = "queued" | "running" | "success" | "skipped" | "error";

type BatchResult = {
  productId: string;
  state: ResultState;
  message?: string;
};

function errorText(value: string) {
  if (value === "product_match_zero_confidence") {
    return "Найденная страница не совпала с товаром";
  }
  if (value === "product_page_not_found") {
    return "Точная карточка товара не найдена";
  }
  if (value === "enrichment_proposal_exists") {
    return "Предложение уже существует";
  }
  if (value === "enrichment_already_running") {
    return "Поиск уже выполняется";
  }
  return value || "Ошибка поиска";
}

async function parseResponse(response: Response) {
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (response.ok) return { ok: true as const, data };

  const object = data as {
    error?: unknown;
    message?: unknown;
    code?: unknown;
  };
  const code = String(object.code || object.error || response.status);
  const message = String(object.message || code);
  return { ok: false as const, code, message };
}

export default function BatchEnrichmentSearch() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, BatchResult>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const eligible = useMemo(
    () =>
      products.filter(
        (product) =>
          product.enrichmentJobs.length === 0 &&
          product.enrichmentProposals.length === 0,
      ),
    [products],
  );

  const selectedEligible = useMemo(
    () => eligible.filter((product) => selected.has(product.id)),
    [eligible, selected],
  );

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/enrichment/products?status=ALL", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      const rows = (await response.json()) as Product[];
      setProducts(rows);
      setSelected((current) => {
        const eligibleIds = new Set(
          rows
            .filter(
              (product) =>
                product.enrichmentJobs.length === 0 &&
                product.enrichmentProposals.length === 0,
            )
            .map((product) => product.id),
        );
        return new Set([...current].filter((id) => eligibleIds.has(id)));
      });
    } catch (error) {
      setMessage(
        `Не удалось загрузить товары: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggle(id: string) {
    if (running) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (running) return;
    setSelected(new Set(eligible.map((product) => product.id)));
  }

  function clearSelection() {
    if (running) return;
    setSelected(new Set());
  }

  function setResult(productId: string, next: BatchResult) {
    setResults((current) => ({ ...current, [productId]: next }));
  }

  async function processProduct(product: Product) {
    setResult(product.id, { productId: product.id, state: "running" });

    try {
      const response = await fetch(
        `/api/admin/enrichment/products/${encodeURIComponent(product.id)}/discover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceUrl: "", discoverIfMissing: true }),
        },
      );
      const parsed = await parseResponse(response);

      if (parsed.ok) {
        setResult(product.id, {
          productId: product.id,
          state: "success",
          message: "Предложение создано",
        });
        return "success" as const;
      }

      if (
        parsed.code === "enrichment_proposal_exists" ||
        parsed.code === "enrichment_already_running"
      ) {
        setResult(product.id, {
          productId: product.id,
          state: "skipped",
          message: errorText(parsed.code),
        });
        return "skipped" as const;
      }

      setResult(product.id, {
        productId: product.id,
        state: "error",
        message: errorText(parsed.code === "enrichment_failed" ? parsed.message : parsed.code),
      });
      return "error" as const;
    } catch (error) {
      setResult(product.id, {
        productId: product.id,
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return "error" as const;
    }
  }

  async function runBatch() {
    const queue = [...selectedEligible];
    if (!queue.length || running) return;

    if (
      queue.length > 25 &&
      !window.confirm(
        `Выбрано ${queue.length} товаров. Это ${queue.length} отдельных поисков OpenAI. Запустить очередь с двумя одновременными запросами?`,
      )
    ) {
      return;
    }

    setRunning(true);
    setMessage(null);
    const initial: Record<string, BatchResult> = {};
    for (const product of queue) {
      initial[product.id] = { productId: product.id, state: "queued" };
    }
    setResults(initial);

    let cursor = 0;
    let success = 0;
    let skipped = 0;
    let failed = 0;

    async function worker() {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= queue.length) return;
        const outcome = await processProduct(queue[index]);
        if (outcome === "success") success += 1;
        else if (outcome === "skipped") skipped += 1;
        else failed += 1;
      }
    }

    try {
      await Promise.all([worker(), worker()]);
      setMessage(
        `Пакетный поиск завершён: предложений создано ${success}, пропущено ${skipped}, без точного результата ${failed}. Успешные товары уже находятся во вкладке «Предложения».`,
      );
      setSelected(new Set());
      await load();
    } finally {
      setRunning(false);
    }
  }

  const completed = Object.values(results).filter((item) =>
    ["success", "skipped", "error"].includes(item.state),
  ).length;
  const totalRunning = Object.keys(results).length;

  return (
    <section className="space-y-4 rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="font-semibold">Пакетный поиск данных</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-700">
            Выберите несколько товаров или все позиции, для которых поиск ещё ни разу не
            запускался. Каждый товар обрабатывается отдельно, одновременно выполняются не
            более двух поисков. Успешные результаты автоматически создают предложения.
          </p>
          <div className="mt-2 text-xs text-gray-500">
            Без поиска: {eligible.length} · выбрано: {selectedEligible.length}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={selectAll}
            disabled={loading || running || eligible.length === 0}
          >
            Выбрать все без поиска
          </button>
          <button
            type="button"
            className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={clearSelection}
            disabled={running || selected.size === 0}
          >
            Снять выбор
          </button>
          <button
            type="button"
            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => void runBatch()}
            disabled={running || selectedEligible.length === 0}
          >
            {running ? "Идёт поиск…" : `Найти данные (${selectedEligible.length})`}
          </button>
        </div>
      </div>

      {running && totalRunning > 0 && (
        <div className="rounded-xl border bg-white p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Обработано {completed} из {totalRunning}</span>
            <span>{Math.round((completed / totalRunning) * 100)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full bg-black transition-all"
              style={{ width: `${Math.round((completed / totalRunning) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {message && <div className="rounded-xl border bg-white px-3 py-2 text-sm">{message}</div>}

      <details className="rounded-xl border bg-white" open={eligible.length <= 20}>
        <summary className="cursor-pointer px-3 py-3 text-sm font-medium">
          Товары без выполненного поиска ({eligible.length})
        </summary>
        <div className="max-h-[32rem] overflow-auto border-t">
          {eligible.map((product) => {
            const result = results[product.id];
            const checked = selected.has(product.id);
            return (
              <label
                key={product.id}
                className="flex cursor-pointer items-start gap-3 border-b px-3 py-3 last:border-b-0 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={checked}
                  disabled={running}
                  onChange={() => toggle(product.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{product.name}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    {product.brand?.name || "Без бренда"}
                    {product.supplierSku ? ` · SKU ${product.supplierSku}` : ""}
                    {product.supplier?.name ? ` · ${product.supplier.name}` : ""}
                  </span>
                  {result && (
                    <span
                      className={`mt-1 block text-xs ${
                        result.state === "success"
                          ? "text-emerald-700"
                          : result.state === "error"
                            ? "text-red-700"
                            : "text-amber-700"
                      }`}
                    >
                      {result.state === "queued"
                        ? "В очереди"
                        : result.state === "running"
                          ? "Поиск…"
                          : result.message || result.state}
                    </span>
                  )}
                </span>
              </label>
            );
          })}

          {!loading && eligible.length === 0 && (
            <div className="px-3 py-5 text-sm text-gray-500">
              Для выбранного рабочего прайса нет товаров, по которым поиск ещё не запускался.
            </div>
          )}
        </div>
      </details>

      <p className="text-xs text-gray-500">
        Стоимость OpenAI растёт примерно пропорционально числу выбранных товаров. Ограничение
        в два параллельных запроса снижает пиковую нагрузку и вероятность rate limit, но не
        уменьшает количество самих поисков.
      </p>
    </section>
  );
}
