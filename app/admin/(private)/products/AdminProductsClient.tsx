"use client";

import { useEffect, useState, type ReactNode } from "react";

type Brand = {
  id: string;
  name: string;
  slug: string;
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
};

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

    const body = {
      name: form.name.trim(),
      brandId: form.brandId ? form.brandId : null,
      description: form.description.trim(),
      image: form.image.trim(),
      category: form.category.trim(),
      price: Math.max(0, Math.trunc(Number(form.price) || 0)),
      stock: Math.max(0, Math.trunc(Number(form.stock) || 0)),
      isPopular: !!form.isPopular,
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
    setForm({
      name: p.name,
      brandId: p.brandId ?? "",
      description: p.description,
      image: p.image,
      category: p.category,
      price: String(Math.trunc(p.price)),
      stock: String(p.stock ?? 0),
      isPopular: p.isPopular ?? false,
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
                // чтобы можно было выбрать тот же файл повторно
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
          {items.map((p) => (
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
          ))}

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