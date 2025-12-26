"use client";

import { useEffect, useState, type ReactNode } from "react";
import { slugify } from "@/lib/slug";

type Post = {
  id: string;
  title: string;
  slug: string;
  content: string;
  category: string;
  image: string | null;
  createdAt: string;
  updatedAt: string;
};

const emptyForm = {
  title: "",
  slug: "",
  content: "",
  category: "новости",
  image: "",
};

export default function AdminBlogClient() {
  const [items, setItems] = useState<Post[]>([]);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/posts", { cache: "no-store" });
    if (res.ok) setItems(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  // slug из title (только при создании и пока slug не трогали руками)
  useEffect(() => {
    if (!editing && !slugTouched) {
      setForm((f) => ({ ...f, slug: slugify(f.title) }));
    }
  }, [form.title, editing, slugTouched]);

  function setField<K extends keyof typeof emptyForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);

    const body = {
      title: form.title.trim(),
      slug: (form.slug.trim() || slugify(form.title)).trim(),
      content: form.content.trim(),
      category: form.category.trim(),
      image: form.image.trim() || null,
    };

    const url = editing ? `/api/posts/${editing}` : `/api/posts`;
    const method = editing ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({} as any));
    setBusy(false);

    if (res.ok) {
      setMsg(editing ? "Пост обновлён" : "Пост создан");
      setForm(emptyForm);
      setEditing(null);
      setSlugTouched(false);
      load();
    } else {
      setMsg(`Ошибка: ${data?.error || res.status}`);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить пост?")) return;
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  function edit(p: Post) {
    setEditing(p.id);
    setSlugTouched(true); // при редактировании slug не автогенерим
    setForm({
      title: p.title,
      slug: p.slug,
      content: p.content,
      category: p.category,
      image: p.image ?? "",
    });
  }

  async function generateDraft() {
    if (!form.title.trim()) {
      setMsg("Сначала укажи тему/заголовок для генерации");
      return;
    }

    setBusy(true);
    setMsg("Генерация черновика…");

    const res = await fetch("/api/posts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: form.title,
        category: form.category || "уход за кожей",
      }),
    });

    const data = await res.json().catch(() => ({} as any));
    setBusy(false);

    if (!res.ok) {
      setMsg(`Ошибка генерации: ${data?.error || res.status}`);
      return;
    }

    setForm((f) => {
      const nextTitle = (data.title || f.title) as string;
      return {
        ...f,
        title: nextTitle,
        // если slug не трогали вручную — обновим
        slug: slugTouched ? f.slug : slugify(nextTitle),
        content: data.content || f.content,
        category: data.category || f.category,
      };
    });

    setMsg("Черновик сгенерирован, проверь и отредактируй");
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* ФОРМА */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">
          {editing ? "Редактировать пост" : "Создать пост"}
        </h2>

        <form className="space-y-3" onSubmit={save}>
          <Field label="Заголовок">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
            />
          </Field>

          <Field label="Slug (URL)">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setField("slug", slugify(e.target.value));
              }}
            />
          </Field>

          <Field label="Категория (например, уход за лицом)">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.category}
              onChange={(e) => setField("category", e.target.value)}
            />
          </Field>

          <Field label="URL обложки (по желанию)">
            <input
              className="w-full border rounded-xl px-3 py-2"
              value={form.image}
              onChange={(e) => setField("image", e.target.value)}
            />
          </Field>

          <Field label="Текст (контент)">
            <textarea
              required
              rows={8}
              className="w-full border rounded-xl px-3 py-2"
              value={form.content}
              onChange={(e) => setField("content", e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap gap-3 items-center">
            <button
              className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
              type="submit"
              disabled={busy}
            >
              {busy ? "Сохранение…" : "Сохранить"}
            </button>

            <button
              type="button"
              className="px-4 py-2 rounded border disabled:opacity-50"
              onClick={generateDraft}
              disabled={busy}
            >
              Сгенерировать черновик
            </button>

            {(editing || form.title || form.slug || form.content) && (
              <button
                type="button"
                className="px-4 py-2 rounded border"
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm);
                  setSlugTouched(false);
                  setMsg(null);
                }}
              >
                Очистить
              </button>
            )}
          </div>

          {msg && <div className="text-sm">{msg}</div>}
        </form>
      </div>

      {/* СПИСОК ПОСТОВ */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Посты</h2>

        <div className="grid grid-cols-1 gap-3">
          {items.map((p) => (
            <div key={p.id} className="rounded-2xl border p-3 flex flex-col gap-2">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-semibold">{p.title}</div>
                  <div className="text-xs text-gray-500">
                    /blog/{p.slug} • {p.category}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn text-xs" onClick={() => edit(p)}>
                    Ред.
                  </button>
                  <button className="btn text-xs" onClick={() => remove(p.id)}>
                    Удалить
                  </button>
                </div>
              </div>

              <div className="text-xs text-gray-500 line-clamp-2">
                {p.content.slice(0, 120)}…
              </div>
            </div>
          ))}

          {items.length === 0 && (
            <div className="text-sm text-gray-500">Постов пока нет</div>
          )}
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
