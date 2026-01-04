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
  price: string; // строка в форме
  stock: string; // строка в форме
  sku?: string;
};

type Product = {
  id: string;
  name: string;
  brandId: string | null;
  brand?: { id: string; name: string } | null;
  description: string;
  image: string;
  category: string;
  price: number;
  stock: number;
  isPopular: boolean;

  // Json из Prisma
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

  // ДОБАВЛЕНО
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

  // загрузка файла
  const [uploading, setUploading] = useState(false);

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

  function setField<K extends keyof typeof emptyForm>(
    k: K,
    v: (typeof emptyForm)[K],
  ) {
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
        { id: makeVariantId(), label: "", price: "", stock: "", sku: "" },
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
      setMsg("Изображение загружено");
    } catch (e: any) {
      setMsg(`Ошибка загрузки: ${e?.message || "upload_failed"}`);
    } finally {
      setUploading(false);
    }
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);

    // Нормализация variants для API (Json)
    const variants =
      form.variants && form.variants.length > 0
        ? form.variants
            .map((v) => ({
              id: String(v.id || "").trim() || makeVariantId(),
              label: String(v.label || "").trim(),
              price: Math.max(0, Math.trunc(Number(v.price) || 0)),
              stock: Math.max(0, Math.trunc(Number(v.stock) || 0)),
              sku: v.sku ? String(v.sku).trim() : undefined,
            }))
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

      // ДОБАВЛЕНО
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
        }))
      : [];

    setForm({
      name: p.name,
      brandId: p.brandId ?? "",
      description: p.description,
      image: p.image,
      category: p.category,
      price: String(Math.trunc(p.price)),
      stock: String(p.stock ?? 0),
      isPopular: p.isPopular ?? false,

      // ДОБАВЛЕНО
      variants: vForm,
    });
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">
          {editing ? "Редактировать" : "Добавить"} товар
        </h2>

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

            <div className="text-xs text-gray-500 mt-1">
              Бренды берутся из /api/brands (активные). Управление брендами вынесем отдельной страницей.
            </div>
          </Field>

          <Field label="Описание">
            <textarea
              required
              rows={3}
              className="w-full border rounded-xl px-3 py-2"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </Field>

          {/* Загрузка изображения файлом */}
          <Field label="Загрузить изображение (файл)">
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

          <Field label="URL изображения">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.image}
              onChange={(e) => setField("image", e.target.value)}
            />
          </Field>

          {/* Превью */}
          <Field label="Превью">
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

          {/* ВАРИАНТЫ */}
          <Field label="Варианты (объём/цена/остаток)">
            <div className="space-y-2">
              <div className="text-xs text-gray-500">
                Если варианты заполнены, на витрине цена и остаток зависят от выбранного объёма.
                Если пусто — используется обычная цена/остаток товара.
              </div>

              {form.variants.length > 0 && (
                <div className="space-y-2">
                  {form.variants.map((v, idx) => (
                    <div key={v.id} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        className="col-span-4 border rounded-xl px-3 py-2"
                        placeholder="Напр. 50 мл"
                        value={v.label}
                        onChange={(e) => setVariantRow(idx, { label: e.target.value })}
                      />

                      <input
                        className="col-span-3 border rounded-xl px-3 py-2"
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

                      <input
                        className="col-span-3 border rounded-xl px-3 py-2"
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

                      <button
                        type="button"
                        className="col-span-2 px-3 py-2 rounded-xl border hover:bg-gray-50"
                        onClick={() => removeVariantRow(idx)}
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
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

          <Field label="Популярный товар (показывать на главной)">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isPopular}
                onChange={(e) => setField("isPopular", e.target.checked)}
              />
              <span>Показывать в блоке «Популярные»</span>
            </label>
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

          <p className="text-xs text-gray-500">
            Цена вводится и хранится в тенге (целое число).
          </p>
        </form>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Товары</h2>

        <div className="grid grid-cols-1 gap-3">
          {items.map((p) => {
            const variantsCount = Array.isArray((p as any).variants)
              ? (p as any).variants.length
              : 0;

            return (
              <div
                key={p.id}
                className="rounded-2xl border p-3 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.image}
                    alt={p.name}
                    className="w-16 h-16 object-cover rounded-lg"
                  />
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      {p.name}
                      {p.isPopular && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200">
                          Популярный
                        </span>
                      )}
                      {variantsCount > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border">
                          Вариантов: {variantsCount}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {(p.brand?.name ?? "—")} •{" "}
                      {Number(p.price).toLocaleString("ru-RU")} ₸ • {p.stock} шт
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
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

          {items.length === 0 && (
            <div className="text-sm text-gray-500">Пока пусто</div>
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
