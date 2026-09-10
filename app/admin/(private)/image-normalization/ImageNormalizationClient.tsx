"use client";

import { useEffect, useState } from "react";

type Status = {
  remaining: number;
  normalized: number;
  retryPending: number;
  needsReview: number;
};

type BatchItem = {
  productId: string;
  productName: string;
  target: "primary" | "variant";
  variantId?: string;
  status: "processed" | "failed" | "needs_review";
  attempts?: number;
  error?: string;
};

type BatchResult = Status & {
  ok?: boolean;
  processed: number;
  failed: number;
  movedToReview: number;
  reset?: number;
  results?: BatchItem[];
};

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

function safeStatus(value: Partial<Status>): Status {
  return {
    remaining: Math.max(0, Number(value.remaining) || 0),
    normalized: Math.max(0, Number(value.normalized) || 0),
    retryPending: Math.max(0, Number(value.retryPending) || 0),
    needsReview: Math.max(0, Number(value.needsReview) || 0),
  };
}

export default function ImageNormalizationClient() {
  const [status, setStatus] = useState<Status>({
    remaining: 0,
    normalized: 0,
    retryPending: 0,
    needsReview: 0,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastResults, setLastResults] = useState<BatchItem[]>([]);

  async function refresh() {
    const response = await fetch("/api/admin/products/normalize-images", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = (await readJson(response)) as Status;
    setStatus(safeStatus(data));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function processBatch(resetNeedsReview = false) {
    const response = await fetch("/api/admin/products/normalize-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 5, resetNeedsReview }),
    });
    const data = (await readJson(response)) as BatchResult & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    setStatus(safeStatus(data));
    setLastResults(data.results || []);
    return data;
  }

  async function runOneBatch() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await processBatch();
      setMessage(
        `Обработано: ${data.processed}. Ошибок: ${data.failed}. На проверку: ${data.movedToReview}. Осталось: ${data.remaining}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось обработать изображения.");
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    if (busy || status.remaining <= 0) return;
    if (
      !confirm(
        "Запустить AI-нормализацию всех доступных изображений товара? Обработка идёт партиями по 5; исходники сохраняются.",
      )
    ) {
      return;
    }

    setBusy(true);
    setMessage("Запущена обработка каталога…");
    setLastResults([]);

    let totalProcessed = 0;
    let totalFailed = 0;
    let totalReview = 0;
    let remaining = status.remaining;
    let retryPending = status.retryPending;
    let needsReview = status.needsReview;

    try {
      for (let batch = 0; batch < 200 && remaining > 0; batch += 1) {
        const data = await processBatch();
        totalProcessed += data.processed;
        totalFailed += data.failed;
        totalReview += data.movedToReview;
        remaining = data.remaining;
        retryPending = data.retryPending;
        needsReview = data.needsReview;

        setMessage(
          `Обработано: ${totalProcessed}. Ошибок: ${totalFailed}. Осталось: ${remaining}. Повтор позже: ${retryPending}. Требует проверки: ${needsReview}.`,
        );

        if (data.processed === 0 && data.failed === 0 && data.movedToReview === 0) {
          break;
        }
      }

      if (remaining === 0) {
        setMessage(
          `Доступная очередь обработана. Готово: ${totalProcessed}. Повтор позже: ${retryPending}. Требует проверки: ${needsReview}.`,
        );
      } else {
        setMessage(
          `За один запуск обработано: ${totalProcessed}. Осталось: ${remaining}. Повторите массовую обработку для продолжения.`,
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Обработка каталога остановлена из-за ошибки.",
      );
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function retryNeedsReview() {
    if (busy || status.needsReview <= 0) return;
    if (!confirm("Сбросить счётчик ошибок для изображений, требующих проверки, и дать им ещё одну попытку?")) {
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const data = await processBatch(true);
      setMessage(
        `Сброшено на повторную обработку: ${data.reset || 0}. Сразу обработано: ${data.processed}. Осталось: ${data.remaining}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось перезапустить изображения.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Изображения товаров</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-600">
          AI удаляет исходный фон, обрезает пустые края и помещает товар по центру квадратного холста. Новые изображения обрабатываются автоматически, а старый каталог можно прогнать целиком без перезаписи оригиналов.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Нормализовано</div>
          <div className="mt-1 text-3xl font-bold">{status.normalized}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Осталось</div>
          <div className="mt-1 text-3xl font-bold">{status.remaining}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Повтор позже</div>
          <div className="mt-1 text-3xl font-bold">{status.retryPending}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Требует проверки</div>
          <div className="mt-1 text-3xl font-bold">{status.needsReview}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || status.remaining <= 0}
          onClick={runOneBatch}
          className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? "Обработка…" : "Обработать 5 изображений"}
        </button>
        <button
          type="button"
          disabled={busy || status.remaining <= 0}
          onClick={runAll}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Нормализовать весь каталог
        </button>
        <button
          type="button"
          disabled={busy || status.needsReview <= 0}
          onClick={retryNeedsReview}
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
        >
          Повторить требующие проверки
        </button>
      </div>

      {message ? (
        <div className="rounded-xl border bg-gray-50 px-4 py-3 text-sm">{message}</div>
      ) : null}

      {lastResults.length ? (
        <div className="max-w-3xl rounded-2xl border bg-white p-4">
          <h2 className="font-semibold">Последняя партия</h2>
          <div className="mt-3 space-y-2 text-sm">
            {lastResults.map((item, index) => (
              <div
                key={`${item.productId}-${item.target}-${item.variantId || index}`}
                className="flex flex-col gap-1 border-b pb-2 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <span>
                    {item.productName}
                    {item.target === "variant" ? " · вариант" : ""}
                  </span>
                  <span
                    className={
                      item.status === "processed"
                        ? "text-emerald-700"
                        : item.status === "needs_review"
                          ? "text-amber-800"
                          : "text-red-700"
                    }
                  >
                    {item.status === "processed"
                      ? "Готово"
                      : item.status === "needs_review"
                        ? "Нужна проверка"
                        : `Ошибка${item.attempts ? ` · попытка ${item.attempts}/3` : ""}`}
                  </span>
                </div>
                {item.error ? <div className="text-xs text-red-700">{item.error}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Исходники не удаляются. После ошибки изображение ждёт повторной попытки не менее часа. После трёх неудач оно переносится в «Требует проверки» и больше не блокирует очередь.
      </div>
    </div>
  );
}
