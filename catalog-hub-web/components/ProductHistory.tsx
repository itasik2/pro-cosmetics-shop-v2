"use client";

import { useEffect, useRef, useState } from "react";
import { coreMessage, coreRequest } from "@/lib/core-client";

type Entry = {
  id: string;
  reason: string;
  actor: string | null;
  createdAt: string;
  source: string | null;
  note: string | null;
  rollbackOf: string | null;
};
type History = { items: Entry[]; nextCursor: string | null };
type Revision = Entry & {
  blocked: string | null;
  expectedVersion: string | null;
  supplierChanged: boolean;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
  legacyValues: Array<{ field: string; before: unknown }>;
};
const fieldLabels: Record<string, string> = {
  title: "Название", barcode: "Штрихкод", brand: "Бренд", categoryKey: "Категория",
  shortDescription: "Краткое описание", description: "Описание", application: "Применение",
  ingredients: "Состав", purchasePrice: "Закупочная цена", price: "Розничная цена",
  attributes: "Характеристики", images: "Фотографии",
};
const reasons: Record<string, string> = {
  MANUAL_CARD_EDIT: "Ручная правка",
  CHANGESET_APPLY: "Применение согласованных изменений",
  PRICE_IMPORT_AUTO: "Обновление цены из прайса",
  CARD_ROLLBACK: "Восстановление карточки",
  VARIANT_GROUP: "Объединение вариантов",
  VARIANT_UNGROUP: "Отмена объединения вариантов",
};
function valueText(value: unknown) {
  if (value == null || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function ProductHistory({ productId, canWrite }: { productId: string; canWrite: boolean }) {
  const path = "catalog/products/" + encodeURIComponent(productId) + "/revisions";
  const [history, setHistory] = useState<History | null>(null);
  const [selected, setSelected] = useState<Revision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    coreRequest<History>(path, undefined, undefined, controller.signal)
      .then(setHistory)
      .catch(error => { if (!controller.signal.aborted) setError(coreMessage(error)); });
    return () => controller.abort();
  }, [path]);

  async function select(id: string) {
    setBusy(true);
    setSelected(null);
    setReason("");
    setConfirmed(false);
    setError("");
    setSuccess("");
    retry.current = null;
    try {
      setSelected(await coreRequest<Revision>(path + "/" + encodeURIComponent(id)));
    } catch (error) {
      setError(coreMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!history?.nextCursor) return;
    setBusy(true);
    setError("");
    try {
      const next = await coreRequest<History>(path + "?after=" + encodeURIComponent(history.nextCursor));
      setHistory({ items: [...history.items, ...next.items], nextCursor: next.nextCursor });
    } catch (error) {
      setError(coreMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function rollback() {
    if (!selected || selected.blocked || !canWrite || !confirmed || !reason.trim()) return;
    const body = { confirmed: true, reason: reason.trim(), expectedVersion: selected.expectedVersion };
    const serialized = JSON.stringify(body);
    if (retry.current?.body !== serialized) retry.current = { body: serialized, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await coreRequest(path + "/" + encodeURIComponent(selected.id) + "/rollback", body, retry.current.key);
      setSelected(null);
      setSuccess("Карточка восстановлена. Откат сохранён в истории.");
      setHistory(await coreRequest<History>(path));
    } catch (error) {
      setError(coreMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel" aria-busy={busy}>
    {error && <p role="alert" className="error">{error}</p>}
    {success && <p role="status">{success}</p>}
    {!history && !error && <p>Загрузка истории…</p>}
    {history?.items.length === 0 && <p>Изменений пока нет.</p>}
    <div className="list">
      {history?.items.map(entry => <div key={entry.id} className="list-row">
        <div>
          <strong>{reasons[entry.reason] ?? entry.reason}</strong>
          <div className="subtle">{new Date(entry.createdAt).toLocaleString("ru-RU")} · {entry.actor || "Автор не указан"}</div>
          {entry.source && <div className="subtle">Источник · {entry.source}</div>}
          {entry.note && <div className="subtle">{entry.note}</div>}
        </div>
        <button type="button" className="button" disabled={busy} onClick={() => void select(entry.id)}>Посмотреть</button>
      </div>)}
    </div>
    {history?.nextCursor && <button type="button" className="button" disabled={busy} onClick={() => void loadMore()}>Ещё записи</button>}
    {selected && <div className="core-preview">
      <h2>{reasons[selected.reason] ?? selected.reason}</h2>
      {selected.rollbackOf && <p className="subtle">Откат записи {selected.rollbackOf}</p>}
      {selected.changes.map(change => <div key={change.field}>
        <h3>{fieldLabels[change.field] ?? change.field}</h3>
        <div className="review-diff">
          <div><strong>До изменения</strong><pre>{valueText(change.before)}</pre></div>
          <div><strong>После изменения</strong><pre>{valueText(change.after)}</pre></div>
        </div>
      </div>)}
      {selected.legacyValues.length > 0 && <div className="review-diff">
        {selected.legacyValues.map(value => <div key={value.field}>
          <strong>{fieldLabels[value.field] ?? value.field} до изменения</strong><pre>{valueText(value.before)}</pre>
        </div>)}
      </div>}
      {selected.supplierChanged && <p>В эту правку входит связанная запись поставщика.</p>}
      {selected.blocked && <p role="status" className="subtle">{coreMessage(selected.blocked)}</p>}
      {canWrite && !selected.blocked && <div className="review-actions">
        <label className="core-field">Причина восстановления
          <input className="input" value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} />
        </label>
        <label className="core-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
          Подтверждаю восстановление значений из колонки «До изменения»
        </label>
        <div><button type="button" className="button primary" disabled={busy || !confirmed || !reason.trim()} onClick={() => void rollback()}>Восстановить карточку</button></div>
      </div>}
    </div>}
  </section>;
}
