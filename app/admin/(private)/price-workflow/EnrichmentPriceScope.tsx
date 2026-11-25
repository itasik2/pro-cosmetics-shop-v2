"use client";

import Link from "next/link";
import { Fragment, type ReactNode, useEffect, useState } from "react";

type ScopeImport = {
  id: string;
  fileName: string;
  sourceDate: string | null;
  appliedAt: string | null;
  createdAt: string;
  totalRows: number;
  readyForPhotos: boolean;
  createdRows: number;
  updatedRows: number;
  supplier: { id: string; name: string };
};

type ScopeResponse = {
  selectedImportId: string;
  imports: ScopeImport[];
};

function formatDate(value: string | null | undefined) {
  if (!value) return "дата не определена";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "дата не определена"
    : date.toLocaleDateString("ru-RU");
}

export default function EnrichmentPriceScope({
  importId, children,
}: {
  importId?: string;
  children: ReactNode;
}) {
  const [data, setData] = useState<ScopeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const query = importId ? "?" + new URLSearchParams({ importId }) : "";
    fetch("/api/admin/enrichment/scope" + query, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(body?.error || response.status));
        return body as ScopeResponse;
      })
      .then((body) => {
        if (active) setData(body);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [importId]);

  async function selectImport(importId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/enrichment/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body?.error || response.status));
      setData((current) =>
        current ? { ...current, selectedImportId: importId } : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return (
      <div className="rounded-2xl border bg-white p-4 text-sm text-gray-500">
        Загружаю список прайсов…
      </div>
    );
  }

  const selected = data?.imports.find((item) => item.id === data.selectedImportId);
  return (
    <>
      <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)] lg:items-end">
          <label className="space-y-1">
            <span className="block text-sm font-semibold">Рабочий прайс</span>
            <select
              className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
              value={data?.selectedImportId || "ALL"}
              disabled={busy || !data}
              onChange={(event) => void selectImport(event.target.value)}
            >
              <option value="ALL">Все товары</option>
              {data?.imports.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.supplier.name} · {item.fileName} · {formatDate(item.sourceDate || item.appliedAt || item.createdAt)}{item.readyForPhotos ? "" : " · ожидает применения"}
                </option>
              ))}
            </select>
          </label>

          <div className="text-xs leading-relaxed text-blue-950/75">
            {selected && !selected.readyForPhotos ? (
              <>
                Из этого прайса пока не применено ни одной строки.{" "}
                <Link href={`/admin/price-workflow?${new URLSearchParams({ step: "import", importId: selected.id })}`}
                  className="underline">
                  Открыть проверку прайса
                </Link>
              </>
            ) : "Поиск фото и предложения ограничены выбранным прайсом. Для общего списка выберите «Все товары»."}
          </div>
        </div>
        {error && <div className="mt-2 text-xs text-red-700">Не удалось выбрать прайс: {error}</div>}
      </section>
      {data && (!selected || selected.readyForPhotos) && (
        <Fragment key={data.selectedImportId}>{children}</Fragment>
      )}
    </>
  );
}
