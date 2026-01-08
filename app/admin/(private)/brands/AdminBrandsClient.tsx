"use client";

import { useEffect, useState, type ReactNode } from "react";

type Brand = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
};

const emptyForm = {
  name: "",
  slug: "",
  sortOrder: "0",
  isActive: true,
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9а-яё-]+/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function AdminBrandsClient() {
  const [items, setItems] = useState<Brand[]>([]);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/brands?all=1", { cache: "no-store" });
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

    const name = form.name.trim();
    const slug = (form.slug.trim() || slugify(name)).trim();

    const body = {
      name,
      slug,
      sortOrder: Math.trunc(Number(form.sortOrder) || 0),
      isActive: !!form.isActive,
    };

    const url = editing ? `/api/brands/${editing}` : "/api/brands";
    const method = editing ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({} as any));
    setBusy(false);

    if (res.ok) {
      setMsg(editing ? "Бренд обновлён" : "Бренд создан");
      setForm(emptyForm);
      setEditing(null);
      load();
    } else {
      setMsg(`Ошибка: ${data?.error || res.status}`);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить бренд? Товары останутся без бренда.")) return;
    const res = await fetch(`/api/brands/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  function edit(b: Brand) {
    setEditing(b.id);
    setForm({
      name: b.name,
      slug: b.slug,
      sortOrder: String(b.sortOrder ?? 0),
      isActive: b.isActive ?? true,
    });
  }

  async function toggleActive(b: Brand) {
    const res = await fetch(`/api/brands/${b.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !b.isActive }),
    });
    if (res.ok) load();
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* ФОРМА */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">
          {editing ? "Редактировать" : "Добавить"} бренд
        </h2>

        <form className="space-y-3" onSubmit={save}>
          <Field label="Название">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.name}
              onChange={(e) => {
                const v = e.target.value;
                setField("name", v);
                if (!editing && !form.slug) {
                  setField("slug", slugify(v));
                }
              }}
            />
          </Field>

          <Field label="Slug (URL ключ, латиница через дефис)">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.slug}
              onChange={(e) => setField("slug", slugify(e.target.value))}
            />
            <div className="text-xs text-gray-500 mt-1">Пример: dermalab, skn-pro, nu-form</div>
          </Field>

          <Field label="Порядок (sortOrder)">
            <input
              type="number"
              step="1"
              className="w-full border rounded-xl px-3 py-2"
              value={form.sortOrder}
              onChange={(e) => setField("sortOrder", e.target.value.replace(/[^\d-]/g, ""))}
              onBlur={(e) => {
                const n = Math.trunc(Number(e.target.value) || 0);
                setField("sortOrder", String(n));
              }}
            />
          </Field>

          <Field label="Активен (показывать в фильтре/админке товаров)">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setField("isActive", e.target.checked)}
              />
              <span>Активен</span>
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
        <h2 className="text-xl font-semibold">Бренды</h2>

        <div className="grid grid-cols-1 gap-3">
          {items.map((b) => (
            <div
              key={b.id}
              className="rounded-2xl border p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <div className="font-semibold flex flex-wrap items-center gap-2">
                  <span className="truncate">{b.name}</span>
                  {!b.isActive && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border shrink-0">
                      Скрыт
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 break-words">
                  slug: {b.slug} • sortOrder: {b.sortOrder}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:flex-nowrap sm:justify-end">
                <button className="btn text-xs" onClick={() => edit(b)} type="button">
                  Ред.
                </button>
                <button className="btn text-xs" onClick={() => toggleActive(b)} type="button">
                  {b.isActive ? "Скрыть" : "Показать"}
                </button>
                <button className="btn text-xs" onClick={() => remove(b.id)} type="button">
                  Удалить
                </button>
              </div>
            </div>
          ))}

          {items.length === 0 && <div className="text-sm text-gray-500">Пока нет брендов</div>}
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
