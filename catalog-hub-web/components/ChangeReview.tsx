"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ReviewField = {
  field: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  status: string;
  beforeValue: unknown;
  afterValue: unknown;
};

const names: Record<string, string> = {
  title: "Название", barcode: "Штрихкод", brand: "Бренд",
  categoryKey: "Категория", shortDescription: "Краткое описание",
  description: "Описание", application: "Применение",
  ingredients: "Состав", purchasePrice: "Закупочная цена",
  price: "Розничная цена", images: "Изображения",
  attributes: "Характеристики",
};
function describe(value: unknown) {
  if (value == null || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function ChangeReview({
  id,
  status,
  fields,
}: {
  id: string;
  status: string;
  fields: ReviewField[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const onPreview = status === "PREVIEW";
  const onApproved = status === "APPROVED";

  function toggle(field: string) {
    setSelected((old) => old.includes(field) ? old.filter((item) => item !== field) : [...old, field]);
    setError("");
  }
  async function action(name: "approve" | "apply" | "reject") {
    if (name === "approve" && !selected.length) {
      setError("Отметьте поля, изменения которых нужно подтвердить.");
      return;
    }
    if (name === "apply" && !confirmApply) {
      setError("Подтвердите применение изменений к товару.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/changes/" + encodeURIComponent(id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: name, approvedFields: selected }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.error || "Ошибка операции"));
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ошибка сохранения";
      setError(message === "changeset_stale"
        ? "Карточка изменилась после создания черновика. Создайте новый черновик из актуальных данных."
        : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <h2>Изменения по полям</h2>
        <p className="subtle">Для подтверждения выберите нужные поля. Цены и фотографии требуют отдельной отметки.</p>
        <div className="review-fields">
          {fields.map((entry) => (
            <div className="review-field" key={entry.field}>
              <div className="review-field-head">
                <label className="review-check">
                  {onPreview && <input type="checkbox" checked={selected.includes(entry.field)} disabled={busy}
                    onChange={() => toggle(entry.field)} />}
                  <strong>{names[entry.field] || entry.field}</strong>
                </label>
                <span className={"badge " + (entry.risk === "HIGH" ? "bad" : entry.risk === "MEDIUM" ? "warn" : "good")}>{entry.risk}</span>
                <span className="badge">{entry.status}</span>
              </div>
              <div className="review-diff">
                <div><span className="subtle">Было</span><pre>{describe(entry.beforeValue)}</pre></div>
                <div><span className="subtle">Предлагается</span><pre>{describe(entry.afterValue)}</pre></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {(onPreview || onApproved) && <section className="panel review-actions">
        <h2>{onPreview ? "Подтверждение" : "Применение к каталогу"}</h2>
        {onPreview ? (
          <div className="actions">
            <button type="button" className="button primary" disabled={busy || !selected.length}
              onClick={() => action("approve")}>Подтвердить выбранные поля ({selected.length})</button>
            <button type="button" className="button" disabled={busy} onClick={() => action("reject")}>Отклонить черновик</button>
          </div>
        ) : (
          <>
            <label className="review-check">
              <input type="checkbox" checked={confirmApply} disabled={busy}
                onChange={(event) => setConfirmApply(event.target.checked)} />
              Подтверждаю внесение одобренных изменений в Master Card
            </label>
            <div className="actions">
              <button type="button" className="button primary" disabled={busy || !confirmApply}
                onClick={() => action("apply")}>{busy ? "Применение…" : "Применить к товару"}</button>
              <button type="button" className="button" disabled={busy} onClick={() => action("reject")}>Отклонить</button>
            </div>
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
      </section>}
    </>
  );
}
