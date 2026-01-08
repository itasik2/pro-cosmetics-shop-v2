// app/admin/(private)/blog/AdminBlogClient.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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

type DraftOptions = {
  audience: string;
  tone: "neutral" | "simple" | "expert" | "marketing";
  depth: "short" | "standard" | "deep";
  includeSlides: boolean;
  includeFAQ: boolean;
  includeChecklist: boolean;
  includeMistakes: boolean;
  // includeTable: boolean; // УДАЛЕНО
};

const UPLOAD_COVER_ENDPOINT = "/api/upload/product-image";
const GENERATE_COVER_ENDPOINT = "/api/posts/generate-cover";

const emptyForm = {
  title: "",
  slug: "",
  content: "",
  category: "новости",
  image: "",
};

const defaultDraft: DraftOptions = {
  audience: "новичкам / чувствительная кожа / без сложной рутины",
  tone: "expert",
  depth: "deep",
  includeSlides: true,
  includeFAQ: true,
  includeChecklist: true,
  includeMistakes: true,
};

export default function AdminBlogClient() {
  const [items, setItems] = useState<Post[]>([]);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const [draft, setDraft] = useState<DraftOptions>(defaultDraft);

  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [coverUploading, setCoverUploading] = useState(false);
  const [coverGenerating, setCoverGenerating] = useState(false);

  async function load() {
    const res = await fetch("/api/posts", { cache: "no-store" });
    if (res.ok) setItems(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!editing && !slugTouched) {
      setForm((f) => ({ ...f, slug: slugify(f.title) }));
    }
  }, [form.title, editing, slugTouched]);

  function setField<K extends keyof typeof emptyForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function setDraftField<K extends keyof DraftOptions>(k: K, v: DraftOptions[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function uploadCover(file: File) {
    setMsg(null);
    setCoverUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(UPLOAD_COVER_ENDPOINT, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        setMsg(`Ошибка загрузки обложки: ${data?.error || res.status}`);
        return;
      }

      const url = String(data?.url || "").trim();
      if (!url) {
        setMsg("Ошибка загрузки обложки: не получен URL");
        return;
      }

      setField("image", url);
      setMsg("Обложка загружена. Не забудь нажать «Сохранить».");
    } catch (e: any) {
      setMsg(`Ошибка загрузки обложки: ${e?.message || "upload_failed"}`);
    } finally {
      setCoverUploading(false);
    }
  }

  async function generateCoverFromTopic() {
    const topic = (form.title || "").trim();
    if (!topic) {
      setMsg("Для генерации обложки сначала укажи заголовок поста (тему).");
      return;
    }

    setMsg(null);
    setCoverGenerating(true);

    try {
      const res = await fetch(GENERATE_COVER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, category: form.category || "уход за кожей" }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setMsg(`Ошибка генерации обложки: ${data?.error || res.status}`);
        return;
      }

      const url = String(data?.url || "").trim();
      if (!url) {
        setMsg("Ошибка генерации обложки: не получен URL");
        return;
      }

      setField("image", url);
      setMsg("Обложка сгенерирована. Не забудь нажать «Сохранить».");
    } catch (e: any) {
      setMsg(`Ошибка генерации обложки: ${e?.message || "generate_failed"}`);
    } finally {
      setCoverGenerating(false);
    }
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
    setSlugTouched(true);
    setForm({
      title: p.title,
      slug: p.slug,
      content: p.content,
      category: p.category,
      image: p.image ?? "",
    });
  }

  const canGenerate = useMemo(() => !!form.title.trim() && !busy, [form.title, busy]);

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

        audience: draft.audience,
        tone: draft.tone,
        depth: draft.depth,

        blocks: {
          slides: draft.includeSlides,
          faq: draft.includeFAQ,
          checklist: draft.includeChecklist,
          mistakes: draft.includeMistakes,
          // table: draft.includeTable, // УДАЛЕНО
        },
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
        slug: slugTouched ? f.slug : slugify(nextTitle),
        content: data.content || f.content,
        category: data.category || f.category,
      };
    });

    setMsg("Черновик сгенерирован. Проверь и отредактируй перед публикацией.");
  }

  return (
    <div className="w-full max-w-full grid md:grid-cols-2 gap-6 sm:gap-8">
      {/* ФОРМА */}
      <div className="space-y-3 min-w-0">
        <h2 className="text-xl font-semibold">{editing ? "Редактировать пост" : "Создать пост"}</h2>

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

          {/* ОБЛОЖКА */}
          <div className="rounded-2xl border p-3 sm:p-4 space-y-3 bg-white/70 backdrop-blur min-w-0">
            <div className="font-semibold">Обложка</div>

            <div className="grid sm:grid-cols-2 gap-3 min-w-0">
              <div className="min-w-0">
                <div className="text-sm text-gray-600 mb-1">Загрузить файл</div>
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy || coverUploading || coverGenerating}
                  className="max-w-full"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadCover(f);
                    e.currentTarget.value = "";
                  }}
                />
                <div className="text-xs text-gray-500 mt-2 break-words">
                  Загружается в Cloudinary через <span className="break-all">{UPLOAD_COVER_ENDPOINT}</span>.
                </div>
              </div>

              <div className="flex flex-col gap-2 min-w-0">
                <button
                  type="button"
                  className="px-4 py-2 rounded border disabled:opacity-50 self-start"
                  onClick={generateCoverFromTopic}
                  disabled={busy || coverUploading || coverGenerating || !form.title.trim()}
                  title={!form.title.trim() ? "Сначала укажи заголовок" : undefined}
                >
                  {coverGenerating ? "Генерация…" : "Сгенерировать обложку по теме"}
                </button>

                <div className="text-xs text-gray-500 break-words">
                  Кнопка работает, если добавлен API-роут{" "}
                  <span className="break-all">{GENERATE_COVER_ENDPOINT}</span>.
                </div>
              </div>
            </div>

            <Field label="URL обложки (по желанию)">
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={form.image}
                onChange={(e) => setField("image", e.target.value)}
                placeholder="https://res.cloudinary.com/.../image/upload/..."
              />
            </Field>

            {form.image ? (
              <div className="mt-2 min-w-0">
                <div className="text-sm text-gray-600 mb-2">Превью</div>
                <div className="rounded-2xl border overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.image}
                    alt="cover preview"
                    className="block w-full max-w-full h-44 object-cover bg-white"
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* НАСТРОЙКИ ГЕНЕРАЦИИ */}
          <div className="rounded-2xl border p-3 sm:p-4 space-y-3 bg-white/70 backdrop-blur min-w-0">
            <div className="font-semibold">Генерация черновика</div>

            <Field label="Для кого (аудитория)">
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={draft.audience}
                onChange={(e) => setDraftField("audience", e.target.value)}
                placeholder="например: чувствительная кожа / акне / 30+ / новичкам"
              />
            </Field>

            <div className="grid sm:grid-cols-2 gap-3 min-w-0">
              <Field label="Тон">
                <select
                  className="w-full border rounded-xl px-3 py-2 bg-white"
                  value={draft.tone}
                  onChange={(e) => setDraftField("tone", e.target.value as DraftOptions["tone"])}
                >
                  <option value="expert">Экспертно</option>
                  <option value="simple">Просто</option>
                  <option value="neutral">Нейтрально</option>
                  <option value="marketing">Маркетингово</option>
                </select>
              </Field>

              <Field label="Глубина">
                <select
                  className="w-full border rounded-xl px-3 py-2 bg-white"
                  value={draft.depth}
                  onChange={(e) => setDraftField("depth", e.target.value as DraftOptions["depth"])}
                >
                  <option value="short">Коротко</option>
                  <option value="standard">Стандарт</option>
                  <option value="deep">Максимально подробно</option>
                </select>
              </Field>
            </div>

            <div className="grid sm:grid-cols-2 gap-2 text-sm min-w-0">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.includeSlides}
                  onChange={(e) => setDraftField("includeSlides", e.target.checked)}
                />
                <span>Под презентацию (--- и якоря)</span>
              </label>

              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.includeFAQ}
                  onChange={(e) => setDraftField("includeFAQ", e.target.checked)}
                />
                <span>FAQ</span>
              </label>

              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.includeChecklist}
                  onChange={(e) => setDraftField("includeChecklist", e.target.checked)}
                />
                <span>Чек-лист</span>
              </label>

              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.includeMistakes}
                  onChange={(e) => setDraftField("includeMistakes", e.target.checked)}
                />
                <span>Ошибки/мифы</span>
              </label>
            </div>

            <div className="text-xs text-gray-500 break-words">
              Заголовки секций должны быть отдельными строками вида <span className="font-mono">**Заголовок**</span>.
            </div>
          </div>

          <Field label="Текст (контент)">
            <textarea
              required
              rows={8}
              className="w-full border rounded-xl px-3 py-2"
              value={form.content}
              onChange={(e) => setField("content", e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap gap-2 sm:gap-3 items-center min-w-0">
            <button
              className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
              type="submit"
              disabled={busy || coverUploading || coverGenerating}
            >
              {busy ? "Сохранение…" : "Сохранить"}
            </button>

            <button
              type="button"
              className="px-4 py-2 rounded border disabled:opacity-50"
              onClick={generateDraft}
              disabled={!canGenerate}
            >
              Сгенерировать черновик
            </button>

            {(editing || form.title || form.slug || form.content || form.image) && (
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

          {msg && <div className="text-sm break-words">{msg}</div>}
        </form>
      </div>

      {/* СПИСОК ПОСТОВ */}
      <div className="space-y-3 min-w-0">
        <h2 className="text-xl font-semibold">Посты</h2>

        <div className="grid grid-cols-1 gap-3 min-w-0">
          {items.map((p) => (
            <div key={p.id} className="rounded-2xl border p-3 sm:p-4 flex flex-col gap-2 min-w-0">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{p.title}</div>
                  <div className="text-xs text-gray-500 break-all">
                    /blog/{p.slug} • {p.category}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:justify-end">
                  <button className="btn text-xs" onClick={() => edit(p)} type="button">
                    Ред.
                  </button>
                  <button className="btn text-xs" onClick={() => remove(p.id)} type="button">
                    Удалить
                  </button>
                </div>
              </div>

              <div className="text-xs text-gray-500 line-clamp-2 break-words">
                {p.content.slice(0, 120)}…
              </div>
            </div>
          ))}

          {items.length === 0 && <div className="text-sm text-gray-500">Постов пока нет</div>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1 min-w-0">
      <label className="block text-sm text-gray-600">{label}</label>
      {children}
    </div>
  );
}
