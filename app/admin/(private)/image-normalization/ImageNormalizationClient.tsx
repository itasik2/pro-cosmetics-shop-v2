"use client";

import { useEffect, useState } from "react";

type Status = {
  remaining: number;
  normalized: number;
};

type BatchResult = Status & {
  ok?: boolean;
  processed: number;
  failed: number;
  results?: Array<{
    id: string;
    name: string;
    status: "processed" | "failed";
    error?: string;
  }>;
};

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export default function ImageNormalizationClient() {
  const [status, setStatus] = useState<Status>({ remaining: 0, normalized: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastResults, setLastResults] = useState<BatchResult["results"]>([]);

  async function refresh() {
    const response = await fetch("/api/admin/products/normalize-images", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = (await readJson(response)) as Status;
    setStatus({
      remaining: Math.max(0, Number(data.remaining) || 0),
      normalized: Math.max(0, Number(data.normalized) || 0),
    });
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function processBatch() {
    const response = await fetch("/api/admin/products/normalize-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 3 }),
    });
    const data = (await readJson(response)) as BatchResult & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    setStatus({ remaining: data.remaining, normalized: data.normalized });
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
        `Обработано: ${data.processed}. Ошибок: ${data.failed}. Осталось: ${data.remaining}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось обработать изображения.");
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    if (busy || status.remaining <= 0) return;
    if (!confirm("Запустить AI-нормализацию всех оставшихся изображений товара? Cloudinary учитывает background removal как специальную трансформацию.")) {
      return;
    }

    setBusy(true);
    setMessage("Запущена обработка каталога…");
    setLastResults([]);

    let totalProcessed = 0;
    let totalFailed = 0;
    let remaining = status.remaining;
    let unchangedFailures = 0;

    try {
      for (let batch = 0; batch < 100 && remaining > 0; batch += 1) {
        const before = remaining;
        const data = await processBatch();
        totalProcessed += data.processed;
        totalFailed += data.failed;
        remaining = data.remaining;

        setMessage(
          `Обработано: ${totalProcessed}. Ошибок: ${totalFailed}. Осталось: ${remaining}.`,
        );

        if (remaining >= before && data.processed === 0) {
          unchangedFailures += 1;
        } else {
          unchangedFailures = 0;
        }

        if (unchangedFailures >= 2) {
          setMessage(
            `Обработано: ${totalProcessed}. Осталось: ${remaining}. Автообработка остановлена: оставшиеся изображения требуют проверки.`,
          );
          break;
        }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Изображения товаров</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-600">
          AI удаляет исходный фон, обрезает пустые края и помещает товар по центру квадратного холста. Новые изображения товаров обрабатываются автоматически при загрузке.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Нормализовано</div>
          <div className="mt-1 text-3xl font-bold">{status.normalized}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Осталось</div>
          <div className="mt-1 text-3xl font-bold">{status.remaining}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || status.remaining <= 0}
          onClick={runOneBatch}
          className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? "Обработка…" : "Обработать 3 изображения"}
        </button>
        <button
          type="button"
          disabled={busy || status.remaining <= 0}
          onClick={runAll}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Нормализовать весь каталог
        </button>
      </div>

      {message ? (
        <div className="rounded-xl border bg-gray-50 px-4 py-3 text-sm">{message}</div>
      ) : null}

      {lastResults?.length ? (
        <div className="max-w-3xl rounded-2xl border bg-white p-4">
          <h2 className="font-semibold">Последняя партия</h2>
          <div className="mt-3 space-y-2 text-sm">
            {lastResults.map((item) => (
              <div key={item.id} className="flex flex-col gap-1 border-b pb-2 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <span>{item.name}</span>
                  <span className={item.status === "processed" ? "text-emerald-700" : "text-red-700"}>
                    {item.status === "processed" ? "Готово" : "Ошибка"}
                  </span>
                </div>
                {item.error ? <div className="text-xs text-red-700">{item.error}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Исходники не удаляются. Для пакетной обработки старое изображение сначала копируется в Cloudinary как отдельный оригинал, и только затем создаётся производная версия для каталога.
      </div>
    </div>
  );
}
