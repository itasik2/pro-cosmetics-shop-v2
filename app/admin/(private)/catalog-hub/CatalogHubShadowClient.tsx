"use client";

import { useCallback, useEffect, useState } from "react";

type StatusResponse = {
  ok: boolean;
  config: {
    enabled: boolean;
    writeEnabled: boolean;
    configured: boolean;
    baseUrl: string | null;
    organizationId: string | null;
    warehouseId: string | null;
    hasApiKey: boolean;
    timeoutMs: number;
  };
  health: unknown;
  summary: {
    checked: number;
    match: number;
    diff: number;
    notFound: number;
    errors: number;
    skipped: number;
  } | null;
  comparisons: Array<{
    status: string;
    localProductId?: string;
    sku?: string | null;
    hubProductId?: string;
    differences?: Array<{
      field: string;
      legacy: unknown;
      hub: unknown;
      equal: boolean;
    }>;
    error?: string;
  }>;
  error?: string;
};

export default function CatalogHubShadowClient() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(20);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResult, setSeedResult] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/catalog-hub/status?limit=${limit}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as StatusResponse;
      setData(body);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSeed = async (dryRun: boolean) => {
    setSeedLoading(true);
    try {
      const response = await fetch("/api/admin/catalog-hub/seed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun, limit: Math.min(limit, 30) }),
      });
      const body = await response.json();
      setSeedResult(body);
      if (!response.ok) return;
      if (!dryRun) await load();
    } finally {
      setSeedLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Catalog Hub</h1>
          <p className="mt-1 text-sm text-gray-500">
            Read-only shadow: сравнение нового Master Catalog с текущим каталогом ProCosmetics.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-gray-500">
            Проверить товаров
            <select
              className="mt-1 block rounded-lg border px-3 py-2 text-sm text-gray-900"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Проверка…" : "Обновить"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Shadow"
          value={data?.config.enabled ? "включён" : "выключен"}
        />
        <Metric
          label="Настройка"
          value={data?.config.configured ? "готова" : "неполная"}
        />
        <Metric label="Hub" value={data?.ok ? "доступен" : "не готов"} />
        <Metric
          label="Организация"
          value={data?.config.organizationId || "не указана"}
        />
        <Metric
          label="Запись"
          value={data?.config.writeEnabled ? "разрешена" : "выключена"}
        />
        <Metric
          label="Склад"
          value={data?.config.warehouseId || "не указан"}
        />
      </div>

      {data?.summary && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Проверено" value={data.summary.checked} />
          <Metric label="Совпало" value={data.summary.match} />
          <Metric label="Различия" value={data.summary.diff} />
          <Metric label="Нет в Hub" value={data.summary.notFound} />
          <Metric label="Ошибки" value={data.summary.errors} />
          <Metric label="Пропущено" value={data.summary.skipped} />
        </div>
      )}

      {data?.error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {data.error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Расхождения</th>
            </tr>
          </thead>
          <tbody>
            {data?.comparisons?.length ? (
              data.comparisons.map((item, index) => (
                <tr
                  key={item.localProductId || `${item.sku}-${index}`}
                  className="border-b last:border-0"
                >
                  <td className="px-4 py-3 font-medium">{item.status}</td>
                  <td className="px-4 py-3">{item.sku || "—"}</td>
                  <td className="px-4 py-3">
                    {item.error ? (
                      <span className="text-red-700">{item.error}</span>
                    ) : item.differences?.length ? (
                      <div className="space-y-2">
                        {item.differences.map((difference) => (
                          <div key={difference.field}>
                            <div className="font-medium">{difference.field}</div>
                            <div className="text-xs text-gray-500">
                              ProCosmetics: {formatValue(difference.legacy)}
                              <br />
                              Catalog Hub: {formatValue(difference.hub)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-8 text-center text-gray-500" colSpan={3}>
                  {loading ? "Проверка…" : "Нет данных для сравнения"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-3">
        <div>
          <h2 className="font-semibold">Первичная миграция</h2>
          <p className="mt-1 text-sm text-gray-500">
            Импортируются только опубликованные товары с supplierSku. Существующие SKU не перезаписываются.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
            onClick={() => void runSeed(true)}
            disabled={seedLoading || !data?.config.configured}
          >
            Dry-run первых {Math.min(limit, 30)}
          </button>
          <button
            type="button"
            className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => void runSeed(false)}
            disabled={
              seedLoading ||
              !data?.config.configured ||
              !data?.config.writeEnabled ||
              !data?.config.warehouseId
            }
          >
            Импортировать в Catalog Hub
          </button>
        </div>
        {!data?.config.writeEnabled && (
          <p className="text-xs text-amber-700">
            Запись заблокирована: CATALOG_HUB_WRITE_ENABLED=false.
          </p>
        )}
        {seedResult !== null && (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs">
            {JSON.stringify(seedResult, null, 2)}
          </pre>
        )}
      </div>

      <details className="rounded-xl border bg-white p-4 text-sm">
        <summary className="cursor-pointer font-medium">Технический статус</summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(data?.health ?? null, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 break-words text-lg font-semibold">{value}</div>
    </div>
  );
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 177)}…` : value;
  }
  return JSON.stringify(value);
}
