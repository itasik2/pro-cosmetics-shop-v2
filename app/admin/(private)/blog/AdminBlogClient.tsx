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
  imageCredit: string | null;
  imageSourceUrl: string | null;
  imageLicense: string | null;
  imageLicenseUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type ImageSearchResult = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  sourceUrl: string;
  credit: string;
  license: string;
  licenseUrl: string;
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
const SEARCH_IMAGES_ENDPOINT = "/api/posts/search-images";
const IMPORT_IMAGE_ENDPOINT = "/api/posts/import-image";

const emptyForm = {
  title: "",
  slug: "",
  content: "",
  category: "новости",
  image: "",
  imageCredit: "",
  imageSourceUrl: "",
  imageLicense: "",
  imageLicenseUrl: "",
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
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [imageSearchResults, setImageSearchResults] = useState<ImageSearchResult[]>([]);
  const [imageSearching, setImageSearching] = useState(false);
  const [imageImportingId, setImageImportingId] = useState<string | null>(null);

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

  function setCover(
    url: string,
    attribution?: Pick<ImageSearchResult, "credit" | "sourceUrl" | "license" | "licenseUrl">
  ) {
    setForm((f) => ({
      ...f,
      image: url,
      imageCredit: attribution?.credit || "",
      imageSourceUrl: attribution?.sourceUrl || "",
      imageLicense: attribution?.license || "",
      imageLicenseUrl: attribution?.licenseUrl || "",
    }));
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

      setCover(url);
      setMsg("Обложка загружена. Не забудьте нажать «Сохранить».");
    } catch (e: any) {
      setMsg(`Ошибка загрузки обложки: ${e?.message || "upload_failed"}`);
    } finally {
      setCoverUploading(false);
    }
  }

  async function generateCoverFromTopic() {
    const topic = (form.title || "").trim();
    if (!topic) {
      setMsg("Для генерации обложки сначала укажите заголовок поста (тему).");
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

      setCover(url);
      setMsg("Обложка сгенерирована. Не забудьте нажать «Сохранить».");
    } catch (e: any) {
      setMsg(`Ошибка генерации обложки: ${e?.message || "generate_failed"}`);
    } finally {
      setCoverGenerating(false);
    }
  }

  async function searchImages() {
    const query = (imageSearchQuery || form.title).trim();
    if (!query) {
      setMsg("Сначала укажите заголовок статьи или запрос для поиска изображения.");
      return;
    }

    setMsg(null);
    setImageSearching(true);
    setImageSearchResults([]);

    try {
      const res = await fetch(`${SEARCH_IMAGES_ENDPOINT}?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setMsg(`Ошибка поиска изображений: ${data?.error || res.status}`);
        return;
      }

      const results = Array.isArray(data?.results)
        ? (data.results as ImageSearchResult[])
        : [];
      setImageSearchResults(results);
      setMsg(
        results.length
          ? `Найдено изображений: ${results.length}. Выберите подходящую обложку.`
          : "По этому запросу подходящих изображений не найдено. Попробуйте более короткую тему."
      );
    } catch (e: any) {
      setMsg(`Ошибка поиска изображений: ${e?.message || "search_failed"}`);
    } finally {
      setImageSearching(false);
    }
  }

  async function importSearchedImage(item: ImageSearchResult) {
    setMsg(null);
    setImageImportingId(item.id);

    try {
      const res = await fetch(IMPORT_IMAGE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.imageUrl }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setMsg(`Ошибка добавления изображения: ${data?.error || res.status}`);
        return;
      }

      const url = String(data?.url || "").trim();
      if (!url) {
        setMsg("Ошибка добавления изображения: не получен URL");
        return;
      }

      setCover(url, item);
      setMsg("Обложка добавлена вместе с источником и лицензией. Нажмите «Сохранить».");
    } catch (e: any) {
      setMsg(`Ошибка добавления изображения: ${e?.message || "import_failed"}`);
    } finally {
      setImageImportingId(null);
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
      imageCredit: form.imageCredit.trim() || null,
      imageSourceUrl: form.imageSourceUrl.trim() || null,
      imageLicense: form.imageLicense.trim() || null,
      imageLicenseUrl: form.imageLicenseUrl.trim() || null,
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
      setImageSearchQuery("");
      setImageSearchResults([]);
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
      imageCredit: p.imageCredit ?? "",
      imageSourceUrl: p.imageSourceUrl ?? "",
      imageLicense: p.imageLicense ?? "",
      imageLicenseUrl: p.imageLicenseUrl ?? "",
    });
    setImageSearchQuery("");
    setImageSearchResults([]);
  }

  const canGenerate = useMemo(() => !!form.title.trim() && !busy, [form.title, busy]);
  const coverBusy =
    coverUploading || coverGenerating || imageSearching || imageImportingId !== null;

  async function generateDraft() {
    if (!form.title.trim()) {
      setMsg("Сначала укажите тему или заголовок для генерации.");
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

    setMsg("Черновик сгенерирован. Проверьте и отредактируйте его перед публикацией.");
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
            <div>
              <div className="font-semibold">Обложка</div>
              <div className="mt-1 text-xs text-gray-500">
                Необязательна: без изображения статья отображается без пустого блока.
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 min-w-0">
              <div className="min-w-0">
                <div className="text-sm text-gray-600 mb-1">Загрузить файл</div>
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy || coverBusy}
                  className="max-w-full"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadCover(f);
                    e.currentTarget.value = "";
                  }}
                />
                <div className="text-xs text-gray-500 mt-2 break-words">
                  Файл автоматически оптимизируется после загрузки.
                </div>
              </div>

              <div className="flex flex-col gap-2 min-w-0">
                <button
                  type="button"
                  className="btn-secondary disabled:opacity-50 self-start"
                  onClick={generateCoverFromTopic}
                  disabled={busy || coverBusy || !form.title.trim()}
                  title={!form.title.trim() ? "Сначала укажите заголовок" : undefined}
                >
                  {coverGenerating ? "Генерация…" : "Сгенерировать обложку по теме"}
                </button>

                <div className="text-xs text-gray-500 break-words">
                  Создаёт новую иллюстрацию без логотипов и надписей.
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
              <div>
                <div className="text-sm font-semibold">Найти готовое изображение по теме</div>
                <div className="mt-1 text-xs text-gray-500">
                  Поиск выполняется в Wikimedia Commons. Автор, источник и лицензия сохраняются
                  автоматически.
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  className="min-w-0 flex-1 border rounded-xl px-3 py-2"
                  value={imageSearchQuery}
                  onChange={(e) => setImageSearchQuery(e.target.value)}
                  placeholder={form.title || "Например: уход за чувствительной кожей"}
                  aria-label="Запрос для поиска изображения"
                  disabled={imageSearching || imageImportingId !== null}
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0 disabled:opacity-50"
                  onClick={searchImages}
                  disabled={busy || coverBusy || !(imageSearchQuery || form.title).trim()}
                >
                  {imageSearching ? "Поиск…" : "Найти по теме"}
                </button>
              </div>

              {imageSearchResults.length > 0 ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  {imageSearchResults.map((item) => (
                    <div key={item.id} className="rounded-xl border overflow-hidden bg-white min-w-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl}
                        alt={item.description || item.title}
                        className="block aspect-[16/10] w-full object-cover bg-gray-50"
                        loading="lazy"
                      />
                      <div className="p-3 space-y-2">
                        <div className="text-sm font-medium line-clamp-2">{item.title}</div>
                        <div className="text-xs text-gray-500 line-clamp-2">
                          {item.credit} · {item.license}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="btn text-xs disabled:opacity-50"
                            onClick={() => importSearchedImage(item)}
                            disabled={imageImportingId !== null || busy}
                          >
                            {imageImportingId === item.id ? "Добавление…" : "Использовать"}
                          </button>
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-link"
                          >
                            Проверить источник
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <Field label="URL обложки (по желанию)">
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={form.image}
                onChange={(e) => setCover(e.target.value)}
                placeholder="https://res.cloudinary.com/.../image/upload/..."
              />
            </Field>

            {form.image ? (
              <div className="mt-2 min-w-0">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-sm text-gray-600">Предпросмотр</div>
                  <button
                    type="button"
                    className="text-xs text-gray-600 underline underline-offset-2"
                    onClick={() => setCover("")}
                  >
                    Убрать обложку
                  </button>
                </div>
                <div className="rounded-2xl border overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.image}
                    alt="Предпросмотр обложки"
                    className="block w-full max-w-full h-44 object-cover bg-white"
                  />
                </div>
                {form.imageSourceUrl ? (
                  <div className="mt-2 text-xs text-gray-500 break-words">
                    Источник: {form.imageCredit || "Wikimedia Commons"}
                    {form.imageLicense ? ` · ${form.imageLicense}` : ""}
                  </div>
                ) : null}
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
                <span>Ошибки и мифы</span>
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
              disabled={busy || coverBusy}
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
                  setImageSearchQuery("");
                  setImageSearchResults([]);
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
