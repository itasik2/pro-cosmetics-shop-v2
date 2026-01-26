"use client";

import { useEffect, useState, type ReactNode } from "react";

type Brand = {
  id: string;
  name: string;
  slug: string;
};

type VariantFormRow = {
  id: string;
  label: string;
  price: string;
  stock: string;
  sku?: string;
  image?: string; // фото варианта (опционально)
};

type Product = {
  id: string;
  name: string;
  brandId: string | null;
  brand?: { id?: string; name: string } | null;
  description?: string; // может не прийти из списка (если API не select-ит)
  image: string;
  category: string;
  price: number;
  stock: number;
  isPopular: boolean;
  isNew?: boolean;
  variants?: any;
};

const emptyForm = {
  name: "",
  brandId: "",
  description: "",
  image: "/seed/cleanser.jpg",
  category: "",
  price: "",
  stock: "",
  isPopular: false,
  isNew: false,
  variants: [] as VariantFormRow[],
};

function makeVariantId() {
  return `v${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

export default function AdminProductsClient() {
  const [items, setItems] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // upload main image
  const [uploading, setUploading] = useState(false);

  // upload variant image
  const [variantUploadingId, setVariantUploadingId] = useState<string | null>(null);

  async function load() {
    const [prodRes, brandRes] = await Promise.all([
      fetch("/api/products", { cache: "no-store" }),
      fetch("/api/brands", { cache: "no-store" }),
    ]);

    if (brandRes.ok) setBrands(await brandRes.json());
    if (prodRes.ok) setItems(await prodRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  function setField<K extends keyof typeof emptyForm>(k: K, v: (typeof emptyForm)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function setVariantRow(idx: number, patch: Partial<VariantFormRow>) {
    setForm((f) => {
      const next = [...f.variants];
      const current = next[idx];
      if (!current) return f;
      next[idx] = { ...current, ...patch };
      return { ...f, variants: next };
    });
  }

  function removeVariantRow(idx: number) {
    setForm((f) => ({
      ...f,
      variants: f.variants.filter((_, i) => i !== idx),
    }));
  }

  function addVariantRow() {
    setForm((f) => ({
      ...f,
      variants: [
        ...f.variants,
        { id: makeVariantId(), label: "", price: "", stock: "", sku: "", image: "" },
      ],
    }));
  }

  async function uploadImage(file: File) {
    setMsg(null);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/upload/product-image", {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const err = data?.error || res.status;
        throw new Error(String(err));
      }

      const url = String(data?.url || "").trim();
      if (!url) throw new Error("no_url_returned");

      setField("image", url);
      setMsg("Изображение товара загружено");
    } catch (e: any) {
      setMsg(`Ошибка загрузки: ${e?.message || "upload_failed"}`);
    } finally {
      setUploading(false);
    }
  }

  async function uploadVariantImage(file: File, idx: number) {
    setMsg(null);

    const row = form.variants[idx];
    if (!row) return;

    setVariantUploadingId(row.id);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/upload/product-image", {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const err = data?.error || res.status;
        throw new Error(String(err));
      }

      const url = String(data?.url || "").trim();
      if (!url) throw new Error("no_url_returned");

      setVariantRow(idx, { image: url });
      setMsg("Изображение варианта загружено");
    } catch (e: any) {
      setMsg(`Ошибка загрузки варианта: ${e?.message || "upload_failed"}`);
    } finally {
      setVariantUploadingId(null);
    }
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);

    const variants =
      form.variants && form.variants.length > 0
        ? form.variants
            .map((v) => {
              const id = String(v.id || "").trim() || makeVariantId();
              const label = String(v.label || "").trim();

              const price = Math.max(0, Math.trunc(Number(v.price) || 0));
              const stock = Math.max(0, Math.trunc(Number(v.stock) || 0));

              const sku = v.sku ? String(v.sku).trim() : undefined;

              const imageRaw = v.image ? String(v.image).trim() : "";
              const image = imageRaw.length > 0 ? imageRaw : undefined;

              return { id, label, price, stock, sku, image };
            })
            .filter((v) => v.label.length > 0)
        : null;

    const body = {
      name: form.name.trim(),
      brandId: form.brandId ? form.brandId : null,
      description: form.description.trim(),
      image: form.image.trim(),
      category: form.category.trim(),
      price: Math.max(0, Math.trunc(Number(form.price) || 0)),
      stock: Math.max(0, Math.trunc(Number(form.stock) || 0)),
      isPopular: !!form.isPopular,
      isNew: !!form.isNew,
      variants,
    };

    const url = editing ? `/api/products/${editing}` : `/api/products`;
    const method = editing ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({} as any));
    setBusy(false);

    if (res.ok) {
      setMsg(editing ? "Обновлено" : "Добавлено");
      setForm(emptyForm);
      setEditing(null);
      load();
    } else {
      setMsg(`Ошибка: ${data?.error || res.status}`);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить товар?")) return;
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  function edit(p: Product) {
    setEditing(p.id);

    const raw = (p as any).variants;
    const vForm: VariantFormRow[] = Array.isArray(raw)
      ? raw.map((v: any) => ({
          id: String(v?.id ?? makeVariantId()),
          label: String(v?.label ?? ""),
          price: String(Math.trunc(Number(v?.price) || 0)),
          stock: String(Math.trunc(Number(v?.stock) || 0)),
          sku: v?.sku ? String(v.sku) : "",
          image: v?.image ? String(v.image) : "",
        }))
      : [];

    setForm({
      name: p.name ?? "",
      brandId: p.brandId ?? "",
      description: String((p as any).description ?? ""), // если API не отдает description — будет пусто
      image: p.image ?? "/seed/cleanser.jpg",
      category: p.category ?? "",
      price: String(Math.trunc(Number(p.price) || 0)),
      stock: String(Math.trunc(Number(p.stock) || 0)),
      isPopular: !!p.isPopular,
      isNew: !!(p as any).isNew,
      variants: vForm,
    });
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="space-y-3 min-w-0">
        <h2 className="text-xl font-semibold">{editing ? "Редактировать" : "Добавить"} товар</h2>

        <form className="space-y-3" onSubmit={save}>
          <Field label="Название">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
            />
          </Field>

          <Field label="Бренд">
            <select
              className="w-full border rounded-xl px-3 py-2 bg-white"
              value={form.brandId}
              onChange={(e) => setField("brandId", e.target.value)}
            >
              <option value="">— без бренда —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Описание">
            <textarea
              required
              rows={4}
              className="w-full border rounded-xl px-3 py-2"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </Field>

          <Field label="Загрузить изображение товара (файл)">
            <input
              type="file"
              accept="image/*"
              className="w-full border rounded-xl px-3 py-2 bg-white"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                uploadImage(file);
                e.currentTarget.value = "";
              }}
            />
            <div className="text-xs text-gray-500 mt-1">
              Файл загрузится в Cloudinary и URL подставится в поле ниже.
            </div>
          </Field>

          <Field label="URL изображения товара">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.image}
              onChange={(e) => setField("image", e.target.value)}
            />
          </Field>

          <Field label="Превью товара">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.image || "/seed/cleanser.jpg"}
                alt="preview"
                className="w-20 h-20 object-cover rounded-xl border bg-gray-50"
              />
              <div className="text-xs text-gray-500">
                {uploading ? "Загрузка…" : "Изображение будет показано в карточке и на странице товара"}
              </div>
            </div>
          </Field>

          <Field label="Категория">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.category}
              onChange={(e) => setField("category", e.target.value)}
            />
          </Field>

          <Field label="Цена (в тенге)">
            <input
              required
              type="number"
              inputMode="numeric"
              step="1"
              min={0}
              pattern="\d*"
              className="w-full border rounded-xl px-3 py-2"
              value={form.price}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d]/g, "");
                setField("price", v);
              }}
              onBlur={(e) => {
                const n = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                setField("price", String(n));
              }}
            />
          </Field>

          <Field label="Остаток, шт">
            <input
              required
              type="number"
              min={0}
              step="1"
              className="w-full border rounded-xl px-3 py-2"
              value={form.stock}
              onChange={(e) => setField("stock", e.target.value)}
            />
          </Field>

          {/* ВАРИАНТЫ — исправленная верстка */}
          <Field label="Варианты (объём/цена/остаток/фото)">
            <div className="space-y-2">
              <div className="text-xs text-gray-500">
                Если у варианта фото не задано — используется основное фото товара.
              </div>

              {form.variants.length > 0 && (
                <div className="space-y-3">
                  {form.variants.map((v, idx) => {
                    const preview =
                      (v.image && String(v.image).trim()) || form.image || "/seed/cleanser.jpg";

                    const uploadingThis = variantUploadingId === v.id;

                    return (
                      <div key={v.id} className="rounded-2xl border p-3 space-y-3 min-w-0">
                        {/* ROW 1 */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start min-w-0">
                          <div className="md:col-span-3 min-w-0">
                            <input
                              className="w-full border rounded-xl px-3 py-2"
                              placeholder="Напр. 50 мл"
                              value={v.label}
                              onChange={(e) => setVariantRow(idx, { label: e.target.value })}
                            />
                          </div>

                          <div className="md:col-span-2 min-w-0">
                            <input
                              className="w-full border rounded-xl px-3 py-2"
                              placeholder="Цена ₸"
                              inputMode="numeric"
                              value={v.price}
                              onChange={(e) =>
                                setVariantRow(idx, { price: e.target.value.replace(/[^\d]/g, "") })
                              }
                              onBlur={(e) => {
                                const n = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                                setVariantRow(idx, { price: String(n) });
                              }}
                            />
                          </div>

                          <div className="md:col-span-2 min-w-0">
                            <input
                              className="w-full border rounded-xl px-3 py-2"
                              placeholder="Остаток"
                              inputMode="numeric"
                              value={v.stock}
                              onChange={(e) =>
                                setVariantRow(idx, { stock: e.target.value.replace(/[^\d]/g, "") })
                              }
                              onBlur={(e) => {
                                const n = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                                setVariantRow(idx, { stock: String(n) });
                              }}
                            />
                          </div>

                          <div className="md:col-span-5 min-w-0">
                            <input
                              className="w-full border rounded-xl px-3 py-2"
                              placeholder="Фото варианта (URL, опционально)"
                              value={v.image ?? ""}
                              onChange={(e) => setVariantRow(idx, { image: e.target.value })}
                            />
                          </div>
                        </div>

                        {/* ROW 2 */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={preview}
                              alt="variant preview"
                              className="w-12 h-12 rounded-xl object-cover border bg-gray-50 shrink-0"
                            />
                            <div className="text-xs text-gray-500 min-w-0">
                              <div className="truncate">
                                Превью: {v.image ? "фото варианта" : "основное фото товара"}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-gray-50 cursor-pointer text-sm whitespace-nowrap">
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={uploadingThis}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  uploadVariantImage(file, idx);
                                  e.currentTarget.value = "";
                                }}
                              />
                              {uploadingThis ? "Загрузка…" : "Загрузить фото"}
                            </label>

                            <button
                              type="button"
                              className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm whitespace-nowrap"
                              onClick={() => removeVariantRow(idx)}
                            >
                              Удалить вариант
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                className="px-4 py-2 rounded-xl border hover:bg-gray-50"
                onClick={addVariantRow}
              >
                + Добавить вариант
              </button>
            </div>
          </Field>

          <Field label="Новинка / Популярный">
            <div className="flex flex-col gap-2 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isNew}
                  onChange={(e) => setField("isNew", e.target.checked)}
                />
                <span>Новинка</span>
              </label>

              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isPopular}
                  onChange={(e) => setField("isPopular", e.target.checked)}
                />
                <span>Показывать в блоке «Популярные»</span>
              </label>
            </div>
          </Field>

          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
              type="submit"
              disabled={busy || uploading}
            >
              {busy ? "Сохранение…" : uploading ? "Загрузка…" : "Сохранить"}
            </button>

            {editing && (
              <button
                type="button"
                className="px-4 py-2 rounded border"
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm);
                }}
              >
                Отмена
              </button>
            )}
          </div>

          {msg && <div className="text-sm">{msg}</div>}

          <p className="text-xs text-gray-500">Цена вводится и хранится в тенге (целое число).</p>
        </form>
      </div>

      <div className="space-y-3 min-w-0">
        <h2 className="text-xl font-semibold">Товары</h2>

        <div className="grid grid-cols-1 gap-3">
          {items.map((p) => {
            const variantsCount = Array.isArray((p as any).variants) ? (p as any).variants.length : 0;

            return (
              <div
                key={p.id}
                className="rounded-2xl border p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 min-w-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.image}
                    alt={p.name}
                    className="w-16 h-16 object-cover rounded-lg shrink-0"
                  />

                  <div className="min-w-0">
                    <div className="font-semibold flex flex-wrap items-center gap-2 min-w-0">
                      <span className="truncate">{p.name}</span>

                      {(p as any).isNew && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                          Новинка
                        </span>
                      )}

                      {p.isPopular && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200 shrink-0">
                          Популярный
                        </span>
                      )}

                      {variantsCount > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border shrink-0">
                          Вариантов: {variantsCount}
                        </span>
                      )}
                    </div>

                    <div className="text-sm text-gray-500 break-words">
                      {(p.brand?.name ?? "—")} • {Number(p.price).toLocaleString("ru-RU")} ₸ •{" "}
                      {p.stock} шт
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:flex-nowrap sm:justify-end">
                  <button className="btn" onClick={() => edit(p)} type="button">
                    Ред.
                  </button>
                  <button className="btn" onClick={() => remove(p.id)} type="button">
                    Удалить
                  </button>
                </div>
              </div>
            );
          })}

          {items.length === 0 && <div className="text-sm text-gray-500">Пока пусто</div>}
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