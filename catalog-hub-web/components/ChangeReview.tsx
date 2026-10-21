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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const onPreview = status === "PREVIEW";
  const onApproved = status === "APPROVED";
  const partiallyApproved=onApproved&&fields.some(f=>f.status!=="APPROVED");

  async function action(name: "confirm" | "reject") {
    if(name==="confirm"&&!window.confirm(`Применить изменения к товару?\n\n${fields.map(f=>names[f.field]||f.field).join(", ")}`))return;
    setBusy(true);
    setError("");
    try {
      const send=async (operation:"approve"|"apply"|"reject")=>{
        const response=await fetch("/api/catalog/changes/"+encodeURIComponent(id),{
          method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({action:operation,
            approvedFields:operation==="approve"?fields.map(f=>f.field):[]}),
        });
        const data=await response.json().catch(()=>null);
        if(!response.ok)throw new Error(String(data?.error||"Ошибка операции"));
      };
      if(name==="reject")await send("reject");
      else {
        if(onPreview)await send("approve");
        await send("apply");
      }
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ошибка сохранения";
      setError(message === "changeset_stale"
        ? "Карточка изменилась после создания черновика. Создайте новый черновик из актуальных данных."
        : message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <h2>Предложение для карточки</h2>
        <p className="subtle">{fields.length} изменений. Раскройте поле, если хотите сравнить значения.</p>
        <div className="review-fields">
          {fields.map((entry) => (
            <details className="review-field" key={entry.field}>
              <summary className="review-field-head">
                  <strong>{names[entry.field] || entry.field}</strong>
                {entry.risk === "HIGH" && <span className="badge bad">Цена</span>}
                <span className="badge">{entry.status}</span>
              </summary>
              <div className="review-diff">
                <div><span className="subtle">Было</span><pre>{describe(entry.beforeValue)}</pre></div>
                <div><span className="subtle">Предлагается</span><pre>{describe(entry.afterValue)}</pre></div>
              </div>
            </details>
          ))}
        </div>
      </section>

      {(onPreview || onApproved) && <section className="panel review-actions">
        <h2>Подтверждение</h2>
        <p className="subtle">{partiallyApproved
          ?"Этот черновик был одобрен частично: применятся только ранее выбранные поля."
          :"Подтверждение применит всё предложение целиком. Для отдельных исправлений откройте карточку товара."}</p>
        <div className="actions">
          <button type="button" className="button primary" disabled={busy||!fields.length}
            onClick={() => action("confirm")}>{busy?"Применение…":"Подтвердить и применить"}</button>
          <button type="button" className="button" disabled={busy} onClick={() => action("reject")}>Отклонить предложение</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
      </section>}
    </>
  );
}
