"use client";

import { useState } from "react";
import type { CatalogHubPilotAudit } from "@/lib/catalogHubPilotAudit";

type Report = CatalogHubPilotAudit & {
  page: { offset: number; total: number; nextOffset: number | null };
  checkedAt: string;
};

const statusLabels = {
  MATCH: "Совпало",
  DIFF: "Есть различия",
  NO_SKU: "Нет SKU",
  NOT_FOUND: "Нет в Catalog Hub",
  AMBIGUOUS: "Повторяется SKU",
  IDENTITY_CONFLICT: "Проверьте бренд и штрихкод",
  INVALID: "Проверьте данные варианта или товара",
};
const fieldLabels = { title: "Название", price: "Цена", available: "Доступно" };
const orderReason = {
  MISSING_SKU: "В заказе не сохранён SKU",
  NO_MAPPING: "Нет однозначного соответствия товару",
  SKU_CHANGED: "Артикул изменился после заказа",
  INVALID_QUANTITY: "Проверьте количество",
};
const errors: Record<string, string> = {
  catalog_hub_shadow_not_configured: "Настройте доступ для теневой сверки.",
  catalog_hub_snapshot_incomplete: "Catalog Hub вернул неполный снимок.",
  catalog_hub_pilot_limit: "Снимок превышает лимит 10 000 позиций. Сверка прервана.",
};

export default function CatalogHubPilotClient() {
  const [report, setReport] = useState<Report | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(offset = 0, showAll = all) {
    setBusy(true);
    setError("");
    setAll(showAll);
    try {
      const query = new URLSearchParams({ offset: String(offset), all: showAll ? "1" : "0" });
      const response = await fetch("/api/admin/catalog-hub/pilot?" + query, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setReport(data);
    } catch (failure) {
      setAll(all);
      setError(errors[failure instanceof Error ? failure.message : ""] || "Не удалось выполнить сверку.");
    } finally {
      setBusy(false);
    }
  }

  const summary = report?.summary;
  return (
    <section aria-busy={busy} className="space-y-4 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Сверка пилота магазина</h2>
        <button type="button" onClick={() => void load()} disabled={busy}
          className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy ? "Сверяем…" : "Сверить каталог и заказы"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {report && summary && <>
        <div role="status" className="space-y-2 text-sm">
          <p>{summary.cards} карточек · {summary.variantCards} с вариантами · {summary.offers} позиций магазина · {summary.hubProducts} товаров в Catalog Hub</p>
          <p>{summary.orders.open} открытых заказов из {summary.orders.total}. Строк без подтверждённого соответствия в открытых заказах: {summary.orders.openUnmappedLines}.</p>
          <p className="text-gray-600">Сверено {new Date(report.checkedAt).toLocaleString("ru-RU")}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(summary.counts).filter(([, count]) => count > 0).map(([status, count]) => (
            <span key={status} className="rounded-md bg-gray-100 px-2 py-1">
              {statusLabels[status as keyof typeof statusLabels]} · {count}
            </span>
          ))}
          {summary.hubOnly > 0 && <span className="rounded-md bg-gray-100 px-2 py-1">Только в Catalog Hub · {summary.hubOnly}</span>}
        </div>
        {report.orderIssues.length > 0 && <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer">Строки открытых заказов для проверки</summary>
          <ul className="mt-2 space-y-2">
            {report.orderIssues.map((row, index) => <li key={index} className="break-words">
              {row.orderId && <a className="font-medium underline" href={"/admin/orders/" + encodeURIComponent(row.orderId)}>Открыть заказ</a>}
              {" · "}{row.sku || "Без SKU"} · {orderReason[row.reason]}
            </li>)}
          </ul>
          {summary.orders.openUnmappedLines > report.orderIssues.length &&
            <p className="mt-2 text-gray-600">Показано {report.orderIssues.length} из {summary.orders.openUnmappedLines} строк.</p>}
        </details>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} disabled={busy} onChange={event => void load(0, event.target.checked)} />
          Показывать совпавшие позиции
        </label>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr><th scope="col" className="p-2">Товар</th><th scope="col" className="p-2">SKU</th><th scope="col" className="p-2">Результат</th></tr>
            </thead>
            <tbody>
              {report.comparisons.map((row, index) => (
                <tr key={JSON.stringify([row.productId, row.variantId, index])} className="border-t align-top">
                  <td className="p-2">{row.title}</td>
                  <td className="p-2 font-mono">{row.sku || "—"}</td>
                  <td className="p-2">
                    {statusLabels[row.status]}
                    {row.differences.map(diff => <div key={diff.field} className="mt-1 text-xs text-gray-600">
                      {fieldLabels[diff.field]} · {diff.store} → {diff.hub ?? "—"}
                    </div>)}
                  </td>
                </tr>
              ))}
              {!report.comparisons.length && <tr><td colSpan={3} className="p-3 text-gray-600">Нет строк для этого фильтра</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" disabled={busy || report.page.offset === 0}
            className="rounded-lg border px-3 py-1 disabled:opacity-50"
            onClick={() => void load(Math.max(0, report.page.offset - 50))}>Назад</button>
          <span>{report.comparisons.length ? report.page.offset + 1 : 0}–{report.page.offset + report.comparisons.length} из {report.page.total}</span>
          <button type="button" disabled={busy || report.page.nextOffset === null}
            className="rounded-lg border px-3 py-1 disabled:opacity-50"
            onClick={() => { if (report.page.nextOffset !== null) void load(report.page.nextOffset); }}>Далее</button>
        </div>
      </>}
    </section>
  );
}
