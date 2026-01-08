"use client";

import { useEffect, useState, type ReactNode } from "react";

type Review = {
  id: string;
  name: string;
  text: string;
  rating: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

const emptyForm = {
  name: "",
  text: "",
  rating: "5",
  isPublic: true,
};

export default function AdminReviewsClient() {
  const [items, setItems] = useState<Review[]>([]);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/reviews", { cache: "no-store" });
    if (res.ok) setItems(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  function setField<K extends keyof typeof emptyForm>(k: K, v: (typeof emptyForm)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);

    const ratingInt = Math.min(5, Math.max(1, Math.trunc(Number(form.rating) || 5)));

    const body = {
      name: form.name.trim(),
      text: form.text.trim(),
      rating: ratingInt,
      isPublic: !!form.isPublic,
    };

    const url = editing ? `/api/reviews/${editing}` : "/api/reviews";
    const method = editing ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({} as any));
    setBusy(false);

    if (res.ok) {
      setMsg(editing ? "Отзыв обновлён" : "Отзыв добавлен");
      setForm(emptyForm);
      setEditing(null);
      load();
    } else {
      setMsg(`Ошибка: ${data?.error || res.status}`);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить отзыв?")) return;
    const res = await fetch(`/api/reviews/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  function edit(r: Review) {
    setEditing(r.id);
    setForm({
      name: r.name,
      text: r.text,
      rating: String(r.rating ?? 5),
      isPublic: r.isPublic ?? true,
    });
  }

  async function togglePublic(r: Review) {
    const res = await fetch(`/api/reviews/${r.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: !r.isPublic }),
    });
    if (res.ok) load();
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* ФОРМА */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">
          {editing ? "Редактировать" : "Добавить"} отзыв
        </h2>

        <form className="space-y-3" onSubmit={save}>
          <Field label="Имя клиента">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
            />
          </Field>

          <Field label="Текст отзыва">
            <textarea
              required
              rows={5}
              className="w-full border rounded-xl px-3 py-2"
              value={form.text}
              onChange={(e) => setField("text", e.target.value)}
            />
          </Field>

          <Field label="Оценка (1–5)">
            <input
              required
              type="number"
              min={1}
              max={5}
              step="1"
              className="w-full border rounded-xl px-3 py-2"
              value={form.rating}
              onChange={(e) => setField("rating", e.target.value.replace(/[^\d]/g, ""))}
              onBlur={(e) => {
                const n = Math.min(5, Math.max(1, Math.trunc(Number(e.target.value) || 5)));
                setField("rating", String(n));
              }}
            />
          </Field>

          <Field label="Показывать на сайте">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(e) => setField("isPublic", e.target.checked)}
              />
              <span>Опубликован</span>
            </label>
          </Field>

          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
              type="submit"
              disabled={busy}
            >
              {busy ? "Сохранение…" : "Сохранить"}
            </button>

            {editing && (
              <button
                type="button"
                className="px-4 py-2 rounded border"
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm);
                  setMsg(null);
                }}
              >
                Отмена
              </button>
            )}
          </div>

          {msg && <div className="text-sm">{msg}</div>}
        </form>
      </div>

      {/* СПИСОК */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Отзывы</h2>

        <div className="grid grid-cols-1 gap-3">
          {items.map((r) => (
            <div key={r.id} className="rounded-2xl border p-3 flex flex-col gap-2">
              {/* Верх: на мобиле — колонка, на sm+ — строка */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{r.name}</div>
                  <div className="text-xs text-gray-500 break-words">
                    Оценка: {r.rating}/5 • {r.isPublic ? "Опубликован" : "Скрыт"}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:flex-nowrap sm:justify-end">
                  <button className="btn text-xs" onClick={() => edit(r)} type="button">
                    Ред.
                  </button>
                  <button className="btn text-xs" onClick={() => togglePublic(r)} type="button">
                    {r.isPublic ? "Скрыть" : "Показать"}
                  </button>
                  <button className="btn text-xs" onClick={() => remove(r.id)} type="button">
                    Удалить
                  </button>
                </div>
              </div>

              <div className="text-sm text-gray-700 whitespace-pre-line break-words">
                {r.text}
              </div>
            </div>
          ))}

          {items.length === 0 && <div className="text-sm text-gray-500">Отзывов пока нет</div>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-gray-600">{label}</label>
      {children}
    </div>
  );
}
