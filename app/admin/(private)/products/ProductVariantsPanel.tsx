"use client";

import { useState } from "react";
import {
  adminStockSummary,
  variantStockChanges,
} from "../../../../lib/adminProductVariants";

type Props = {
  product: { id: string; name: string; stock: number; variants?: unknown };
  onEdit: () => void;
  onSaved: () => void;
};

export function VariantSummary({ product }: Pick<Props, "product">) {
  const { variants, total, available } = adminStockSummary(product);
  return (
    <div className="mt-2 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">Всего: {total} шт.</span>
        <span className="text-gray-500">
          {variants.length
            ? `Вариантов: ${variants.length} · в наличии: ${available}`
            : "Без вариантов"}
        </span>
      </div>
      {variants.length > 0 && (
        <ul
          aria-label={`Остатки вариантов «${product.name}»`}
          className="flex flex-wrap gap-2"
        >
          {variants.map((variant) => (
            <li
              key={variant.id}
              className={`rounded-lg border px-2 py-1 text-xs ${variant.stock ? "bg-gray-50" : "border-amber-200 bg-amber-50 text-amber-900"}`}
            >
              {variant.label} · {variant.stock} шт.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ProductVariantsPanel({
  product,
  onEdit,
  onSaved,
}: Props) {
  const { variants, total } = adminStockSummary(product);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = variants.some(
    (row) => draft[row.id] !== undefined && draft[row.id] !== String(row.stock),
  );
  const pendingTotal = variants.reduce(
    (sum, row) =>
      sum +
      (draft[row.id] === undefined ? row.stock : Number(draft[row.id]) || 0),
    0,
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setMessage("");
    try {
      const stocks = variantStockChanges(variants, draft);
      if (!stocks.length) {
        setDraft({});
        return;
      }
      setBusy(true);
      const response = await fetch(
        `/api/products/${encodeURIComponent(product.id)}/variant-stock`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stocks }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data.message ||
            (data.error === "variant_not_found"
              ? "Состав вариантов изменился. Обновите страницу."
              : "Не удалось сохранить остатки."),
        );
      setDraft({});
      setMessage(`Остатки сохранены. Всего: ${data.stock} шт.`);
      onSaved();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить остатки.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-3 rounded-xl border bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Варианты и остатки{variants.length ? ` (${variants.length})` : ""}
      </summary>
      <div className="border-t p-3">
        {variants.length ? (
          <form onSubmit={save} className="space-y-3">
            <fieldset disabled={busy} className="space-y-2">
              {variants.map((variant) => (
                <div
                  key={variant.id}
                  className="grid gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-[minmax(0,1fr)_110px_140px] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{variant.label}</div>
                    {variant.sku && (
                      <div className="break-all text-xs text-gray-500">
                        SKU {variant.sku}
                      </div>
                    )}
                  </div>
                  <div className="text-sm">
                    {variant.price.toLocaleString("ru-RU")} ₸
                  </div>
                  <label className="block text-xs text-gray-600">
                    Остаток, шт.
                    <input
                      aria-label={`Остаток ${variant.label} — ${product.name}`}
                      type="number"
                      min={0}
                      max={1_000_000}
                      step={1}
                      required
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                      value={draft[variant.id] ?? String(variant.stock)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [variant.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-600">
                {dirty ? "После сохранения" : "Общий остаток"}:{" "}
                <strong>{dirty ? pendingTotal : total} шт.</strong>
              </p>
              <div className="flex flex-wrap gap-2">
                {dirty && (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border px-3 py-2 text-sm"
                    onClick={() => {
                      setDraft({});
                      setMessage("");
                    }}
                  >
                    Отменить
                  </button>
                )}
                <button
                  type="submit"
                  disabled={busy || !dirty}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-40"
                >
                  {busy ? "Сохраняем…" : "Сохранить остатки"}
                </button>
              </div>
            </div>
            {message && (
              <p role="status" className="text-sm">
                {message}
              </p>
            )}
          </form>
        ) : (
          <p className="text-sm text-gray-500">
            Добавьте объёмы или другие варианты с отдельной ценой и остатком.
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          className="mt-3 rounded-lg border px-3 py-2 text-sm"
          onClick={() => {
            if (
              !dirty ||
              window.confirm("Открыть карточку без сохранения новых остатков?")
            ) {
              setDraft({});
              onEdit();
            }
          }}
        >
          {variants.length
            ? "Изменить варианты, цены и фото"
            : "+ Добавить варианты"}
        </button>
      </div>
    </details>
  );
}
