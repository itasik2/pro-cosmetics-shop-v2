"use client";

import { useEffect, useState } from "react";

type ImportItem = {
  id: string;
  fileName: string;
  status: "UPLOADED" | "PARSING" | "REVIEW" | "APPLIED" | "FAILED";
  createdAt: string;
  totalRows: number;
  supplier: { name: string };
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
}

export default function PriceImportMaintenance() {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/admin/price-imports", { cache: "no-store" });
    if (!response.ok) return;
    const rows = (await response.json()) as ImportItem[];
    setItems(rows.filter((row) => row.status !== "APPLIED"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(item: ImportItem) {
    if (!confirm(`Удалить импорт «${item.fileName}»? Товары из неприменённого импорта не создавались.`)) {
      return;
    }

    setBusyId(item.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/price-imports/${item.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data.message || data.error || response.status));
      }
      setMessage("Импорт удалён.");
      await load();
      window.dispatchEvent(new Event("price-imports-changed"));
    } catch (error) {
      setMessage(
        `Не удалось удалить импорт: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-2xl border p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Удаление неприменённых импортов</h2>
        <p className="mt-1 text-xs text-gray-500">
          Неудачные и ожидающие проверки загрузки можно удалить. Применённые импорты
          остаются журналом изменения товаров и цен.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-gray-500">Неприменённых импортов нет.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="font-medium break-words">{item.fileName}</div>
                <div className="text-xs text-gray-500">
                  {item.supplier.name} • {item.status} • строк: {item.totalRows} •{" "}
                  {formatDate(item.createdAt)}
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                disabled={busyId === item.id}
                onClick={() => remove(item)}
              >
                {busyId === item.id ? "Удаление…" : "Удалить импорт"}
              </button>
            </div>
          ))}
        </div>
      )}

      {message && <div className="text-sm">{message}</div>}
    </section>
  );
}
