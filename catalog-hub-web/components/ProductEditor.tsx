"use client";

import { useState, type FormEvent } from "react";
import type { HubProduct } from "@/lib/hub";

type Values = {
  title: string;
  barcode: string;
  brand: string;
  categoryKey: string;
  shortDescription: string;
  description: string;
  application: string;
  ingredients: string;
  purchasePrice: string;
  price: string;
  attributes: string;
  images: string;
};

const textInputs = [
  ["title", "Название *"],
  ["brand", "Бренд"],
  ["barcode", "Штрихкод"],
  ["categoryKey", "Категория"],
  ["shortDescription", "Краткое описание (до 280 символов)"],
  ["description", "Полное описание"],
  ["application", "Применение"],
  ["ingredients", "Состав"],
] as const;


function formatAttributes(value: unknown): string {
  // Imported legacy cards store a serialized JSON object inside a jsonb string.
  // Unwrap a bounded number of JSON string layers for display without rewriting data.
  let decoded = value;
  for (let layer = 0; layer < 2 && typeof decoded === "string"; layer++) {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return decoded;
    }
  }
  if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
    return JSON.stringify(decoded, null, 2);
  }
  return typeof decoded === "string" ? decoded : "{}";
}

export function ProductEditor({ product }: { product: HubProduct }) {
  const [form, setForm] = useState<Values>({
    title: product.title || "",
    barcode: product.barcode || "",
    brand: product.brand || "",
    categoryKey: product.categoryKey || "",
    shortDescription: product.shortDescription || "",
    description: product.description || "",
    application: product.application || "",
    ingredients: product.ingredients || "",
    purchasePrice: product.purchasePrice == null ? "" : String(product.purchasePrice),
    price: product.price == null ? "" : String(product.price),
    attributes: formatAttributes(product.attributes),
    images: (product.images || []).join("\n"),
  });
  const [dirty, setDirty] = useState<Set<keyof Values>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(key: keyof Values, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => new Set(prev).add(key));
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    // Only submit fields the operator actually edited. Imported legacy data in
    // unrelated fields must never be silently normalized or erased by price edits.
    if (dirty.size === 0) {
      setError("Нет изменений для сохранения.");
      return;
    }
    const proposed: Record<string, unknown> = {};
    for (const [key] of textInputs) {
      if (!dirty.has(key)) continue;
      const value = form[key].trim();
      if (key === "title" && !value) {
        setError("Укажите название товара.");
        return;
      }
      proposed[key] = value || null;
    }
    for (const key of ["purchasePrice", "price"] as const) {
      if (!dirty.has(key)) continue;
      const raw = form[key].trim();
      const value = raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isSafeInteger(value) ||
        value < (key === "price" ? 1 : 0))) {
        setError("Проверьте цену: нужны целые неотрицательные значения, розничная цена — больше нуля.");
        return;
      }
      proposed[key] = value;
    }
    if (dirty.has("attributes")) {
      try {
        let parsed: unknown = JSON.parse(form.attributes);
        for (let layer = 0; layer < 2 && typeof parsed === "string"; layer++) {
          parsed = JSON.parse(parsed);
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        proposed.attributes = parsed;
      } catch {
        setError("Характеристики должны быть JSON-объектом.");
        return;
      }
    }
    if (dirty.has("images")) {
      const images = form.images.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
      if (images.some((src) => !/^https?:\/\/[^ ]+$/i.test(src))) {
        setError("Ссылки на фотографии должны начинаться с http:// или https://.");
        return;
      }
      proposed.images = images;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/catalog/changes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: product.id, proposed }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(data?.error || "Не удалось сохранить изменения"));
      window.location.assign("/changes/" + encodeURIComponent(data.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message === "changeset_empty" ? "Изменений нет." : message);
      setBusy(false);
    }
  }

  return (
    <form className="panel editor-panel" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <h2>Редактор Master Card</h2>
          <p className="subtle">Изменения сначала сохраняются в очередь на проверку. Товар не меняется до подтверждения и применения.</p>
        </div>
        <span className="badge warn">Review-first</span>
      </div>
      <div className="editor-grid">
        {textInputs.map(([key, label]) => (
          <label className={["description","application","ingredients","shortDescription"].includes(key) ? "editor-field wide" : "editor-field"} key={key}>
            <span>{label}</span>
            {["description","application","ingredients","shortDescription"].includes(key) ? (
              <textarea
                rows={key === "description" ? 6 : 3}
                maxLength={key === "shortDescription" ? 280 : undefined}
                value={form[key]}
                onChange={(event) => update(key, event.target.value)}
              />
            ) : (
              <input className="input" value={form[key]} maxLength={key === "title" ? 500 : undefined}
                onChange={(event) => update(key, event.target.value)} required={key === "title"} />
            )}
          </label>
        ))}
        <label className="editor-field">
          <span>Закупочная цена, ₸</span>
          <input className="input" type="number" min="0" step="1" value={form.purchasePrice} onChange={(event) => update("purchasePrice", event.target.value)} />
        </label>
        <label className="editor-field">
          <span>Розничная цена, ₸</span>
          <input className="input" type="number" min="1" step="1" value={form.price} onChange={(event) => update("price", event.target.value)} />
        </label>
        <label className="editor-field wide">
          <span>Ссылки на изображения (по одной в строке)</span>
          <textarea rows={4} value={form.images} onChange={(event) => update("images", event.target.value)} />
        </label>
        <label className="editor-field wide">
          <span>Характеристики (JSON)</span>
          <textarea className="editor-json" rows={5} value={form.attributes} onChange={(event) => update("attributes", event.target.value)} />
        </label>
      </div>
      <p className="subtle">SKU и складские остатки защищены от прямого редактирования. Для них предусмотрены отдельные операции. Изменённых полей: {dirty.size}.</p>
      {error && <div role="alert" className="error">{error}</div>}
      <div className="actions"><button type="submit" className="button primary" disabled={busy || dirty.size === 0}>{busy ? "Сохранение…" : "Сохранить на проверку →"}</button></div>
    </form>
  );
}
