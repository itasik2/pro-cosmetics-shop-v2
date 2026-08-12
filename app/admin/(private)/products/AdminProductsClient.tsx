"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

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
  image?: string;
};

type VariantData = {
  id?: unknown;
  label?: unknown;
  price?: unknown;
  stock?: unknown;
  sku?: unknown;
  image?: unknown;
};

type Product = {
  id: string;
  name: string;
  brandId: string | null;
  brand?: { id?: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  supplierSku?: string | null;
  sourcePrice?: number | null;
  description?: string;
  image: string;
  category: string;
  price: number;
  stock: number;
  isPopular: boolean;
  isNew: boolean;
  isPublished: boolean;
  enrichmentStatus?: string;
  variants?: unknown;
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
  isPublished: true,
  variants: [] as VariantFormRow[],
};

function makeVariantId() {
  return `v${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function parseVariantRows(value: unknown): VariantFormRow[] {
  if (!Array.isArray(value)) return [];

  return value.map((raw) => {
    const variant =
      raw && typeof raw === "object" ? (raw as VariantData) : {};

    return {
      id: String(variant.id ?? makeVariantId()),
      label: String(variant.label ?? ""),
      price: String(Math.trunc(Number(variant.price) || 0)),
      stock: String(Math.trunc(Number(variant.stock) || 0)),
      sku: variant.sku ? String(variant.sku) : "",
      image: variant.image ? String(variant.image) : "",
    };
  });
}

async function readJson(response: Response) {
  return response.json().catch(() => ({} as Record<string, unknown>));
}

function normalizeSearch(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productMatchesSearch(product: Product, query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;

  const variantParts: string[] = [];
  if (Array.isArray(product.variants)) {
    for (const raw of product.variants) {
      if (!raw || typeof raw !== "object") continue;
      const variant = raw as VariantData;
      if (variant.label != null) variantParts.push(String(variant.label));
      if (variant.sku != null) variantParts.push(String(variant.sku));
    }
  }

  const haystack = normalizeSearch([
    product.name,
    product.brand?.name,
    product.supplier?.name,
    product.supplierSku,
    product.category,
    ...variantParts,
  ].filter(Boolean).join(" "));

  return normalizedQuery.split(" ").every((token) => haystack.includes(token));
}

export default function AdminProductsClient() {
  const [items, setItems] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [variantUploadingId, setVariantUploadingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  async function load() {
    const [productResponse, brandResponse] = await Promise.all([
      fetch("/api/products", { cache: "no-store" }),
      fetch("/api/brands", { cache: "no-store" }),
    ]);

    if (brandResponse.ok) setBrands(await brandResponse.json());
    if (productResponse.ok) setItems(await productResponse.json());
  }

  useEffect(() => {
    load();
  }, []);

  function setField<K extends keyof typeof emptyForm>(
    key: K,
    value: (typeof emptyForm)[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setVariantRow(index: number, patch: Partial<VariantFormRow>) {
    setForm((current) => {
      const next = [...current.variants];
      const row = next[index];
      if (!row) return current;
      next[index] = { ...row, ...patch };
      return { ...current, variants: next };
    });
  }

  function removeVariantRow(index: number) {
    setForm((current) => ({
      ...current,
      variants: current.variants.filter((_, rowIndex) => rowIndex !== index),
    }));
  }

  function addVariantRow() {
    setForm((current) => ({
      ...current,
      variants: [
        ...current.variants,
        {
          id: makeVariantId(),
          label: "",
          price: "",
          stock: "",
          sku: "",
          image: "",
        },
      ],
    }));
  }

  async function uploadFile(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/upload/product-image", {
      method: "POST",
      body: formData,
    });
    const data = (await readJson(response)) as { url?: unknown; error?: unknown };

    if (!response.ok) {
      throw new Error(String(data.error || response.status));
    }

    const url = String(data.url || "").trim();
    if (!url) throw new Error("no_url_returned");
    return url;
  }

  async function uploadImage(file: File) {
    setMsg(null);
    setUploading(true);

    try {
      const url = await uploadFile(file);
      setField("image", url);
      setMsg("Изображение товара загружено");
    } catch (error: any) {
      setMsg(`Ошибка загрузки: ${error?.message || "upload_failed"}`);
    } finally {
      setUploading(false);
    }
  }

  async function uploadVariantImage(file: File, index: number) {
    setMsg(null);
    const row = form.variants[index];
    if (!row) return;

    setVariantUploadingId(row.id);
    try {
      const url = await uploadFile(file);
      setVariantRow(index, { image: url });
      setMsg("Изображение варианта загружено");
    } catch (error: any) {
      setMsg(`Ошибка загрузки варианта: ${error?.message || "upload_failed"}`);
    } finally {
      setVariantUploadingId(null);
    }
  }

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setMsg(null);

    const variants = form.variants.length
      ? form.variants
          .map((variant) => {
            const image = String(variant.image || "").trim();
            const sku = String(variant.sku || "").trim();

            return {
              id: String(variant.id || "").trim() || makeVariantId(),
              label: String(variant.label || "").trim(),
              price: Math.max(0, Math.trunc(Number(variant.price) || 0)),
              stock: Math.max(0, Math.trunc(Number(variant.stock) || 0)),
              sku: sku || undefined,
              image: image || undefined,
            };
          })
          .filter((variant) => variant.label.length > 0)
      : null;

    const body = {
      name: form.name.trim(),
      brandId: form.brandId || null,
      description: form.description.trim(),
      image: form.image.trim(),
      category: form.category.trim(),
      price: Math.max(0, Math.trunc(Number(form.price) || 0)),
      stock: Math.max(0, Math.trunc(Number(form.stock) || 0)),
      isPopular: form.isPopular,
      isNew: form.isNew,
      isPublished: form.isPublished,
      variants,
    };

    try {
      const response = await fetch(
        editing ? `/api/products/${editing}` : "/api/products",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await readJson(response)) as { error?: unknown };

      if (!response.ok) {
        throw new Error(String(data.error || response.status));
      }

      setMsg(editing ? "Товар обновлён" : "Товар добавлен");
      setForm(emptyForm);
      setEditing(null);
      await load();
    } catch (error: any) {
      setMsg(`Ошибка: ${error?.message || "save_failed"}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить товар?")) return;

    const response = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (response.ok) {
      if (editing === id) {
        setEditing(null);
        setForm(emptyForm);
      }
      await load();
    } else {
      setMsg("Не удалось удалить товар");
    }
  }

  function edit(product: Product) {
    setEditing(product.id);
    setForm({
      name: product.name || "",
      brandId: product.brandId || "",
      description: String(product.description || ""),
      image: product.image || "/seed/cleanser.jpg",
      category: product.category || "",
      price: String(Math.trunc(Number(product.price) || 0)),
      stock: String(Math.trunc(Number(product.stock) || 0)),
      isPopular: Boolean(product.isPopular),
      isNew: Boolean(product.isNew),
      isPublished: Boolean(product.isPublished),
      variants: parseVariantRows(product.variants),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const filteredItems = useMemo(
    () => items.filter((product) => productMatchesSearch(product, searchQuery)),
    [items, searchQuery],
  );

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="space-y-3 min-w-0">
        <h2 className="text-xl font-semibold">
          {editing ? "Редактировать" : "Добавить"} товар
        </h2>

        <form className="space-y-3" onSubmit={save}>
          <Field label="Название">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
            />
          </Field>

          <Field label="Бренд">
            <select
              className="w-full border rounded-xl px-3 py-2 bg-white"
              value={form.brandId}
              onChange={(event) => setField("brandId", event.target.value)}
            >
              <option value="">— без бренда —</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Описание">
            <textarea
              required
              rows={5}
              className="w-full border rounded-xl px-3 py-2"
              value={form.description}
              onChange={(event) => setField("description", event.target.value)}
            />
          </Field>

          <Field label="Загрузить изображение товара">
            <input
              type="file"
              accept="image/*"
              className="w-full border rounded-xl px-3 py-2 bg-white"
              disabled={uploading}
              onChange={(event) => {
                const selectedFile = event.target.files?.[0];
                if (selectedFile) uploadImage(selectedFile);
                event.currentTarget.value = "";
              }}
            />
            <div className="text-xs text-gray-500 mt-1">
              Файл загрузится в Cloudinary, URL подставится автоматически.
            </div>
          </Field>

          <Field label="URL изображения товара">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.image}
              onChange={(event) => setField("image", event.target.value)}
            />
          </Field>

          <Field label="Превью товара">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.image || "/seed/cleanser.jpg"}
                alt="Предпросмотр товара"
                className="w-20 h-20 object-cover rounded-xl border bg-gray-50"
              />
              <div className="text-xs text-gray-500">
                {uploading
                  ? "Загрузка…"
                  : "Изображение будет показано в карточке товара"}
              </div>
            </div>
          </Field>

          <Field label="Категория">
            <input
              required
              className="w-full border rounded-xl px-3 py-2"
              value={form.category}
              onChange={(event) => setField("category", event.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Цена, ₸">
              <input
                required
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                className="w-full border rounded-xl px-3 py-2"
                value={form.price}
                onChange={(event) =>
                  setField("price", event.target.value.replace(/[^\d]/g, ""))
                }
              />
            </Field>

            <Field label="Остаток, шт.">
              <input
                required
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                className="w-full border rounded-xl px-3 py-2"
                value={form.stock}
                onChange={(event) =>
                  setField("stock", event.target.value.replace(/[^\d]/g, ""))
                }
              />
            </Field>
          </div>

          <Field label="Варианты (объём / цена / остаток / фото)">
            <div className="space-y-3">
              {form.variants.map((variant, index) => {
                const preview =
                  String(variant.image || "").trim() ||
                  form.image ||
                  "/seed/cleanser.jpg";
                const uploadingThis = variantUploadingId === variant.id;

                return (
                  <div key={variant.id} className="rounded-2xl border p-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                      <input
                        className="md:col-span-3 border rounded-xl px-3 py-2"
                        placeholder="Напр. 50 мл"
                        value={variant.label}
                        onChange={(event) =>
                          setVariantRow(index, { label: event.target.value })
                        }
                      />
                      <input
                        className="md:col-span-2 border rounded-xl px-3 py-2"
                        placeholder="Цена ₸"
                        inputMode="numeric"
                        value={variant.price}
                        onChange={(event) =>
                          setVariantRow(index, {
                            price: event.target.value.replace(/[^\d]/g, ""),
                          })
                        }
                      />
                      <input
                        className="md:col-span-2 border rounded-xl px-3 py-2"
                        placeholder="Остаток"
                        inputMode="numeric"
                        value={variant.stock}
                        onChange={(event) =>
                          setVariantRow(index, {
                            stock: event.target.value.replace(/[^\d]/g, ""),
                          })
                        }
                      />
                      <input
                        className="md:col-span-2 border rounded-xl px-3 py-2"
                        placeholder="SKU"
                        value={variant.sku || ""}
                        onChange={(event) =>
                          setVariantRow(index, { sku: event.target.value })
                        }
                      />
                      <input
                        className="md:col-span-3 border rounded-xl px-3 py-2"
                        placeholder="Фото варианта"
                        value={variant.image || ""}
                        onChange={(event) =>
                          setVariantRow(index, { image: event.target.value })
                        }
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preview}
                          alt="Предпросмотр варианта"
                          className="w-12 h-12 rounded-xl object-cover border bg-gray-50"
                        />
                        <span className="text-xs text-gray-500">
                          {variant.image ? "Фото варианта" : "Основное фото"}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <label className="inline-flex items-center px-3 py-2 rounded-xl border hover:bg-gray-50 cursor-pointer text-sm">
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={uploadingThis}
                            onChange={(event) => {
                              const selectedFile = event.target.files?.[0];
                              if (selectedFile) {
                                uploadVariantImage(selectedFile, index);
                              }
                              event.currentTarget.value = "";
                            }}
                          />
                          {uploadingThis ? "Загрузка…" : "Загрузить фото"}
                        </label>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm"
                          onClick={() => removeVariantRow(index)}
                        >
                          Удалить вариант
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                className="px-4 py-2 rounded-xl border hover:bg-gray-50"
                onClick={addVariantRow}
              >
                + Добавить вариант
              </button>
            </div>
          </Field>

          <Field label="Статус товара">
            <div className="flex flex-col gap-2 text-sm">
              <label className="inline-flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={form.isPublished}
                  onChange={(event) =>
                    setField("isPublished", event.target.checked)
                  }
                />
                <span>Опубликован на сайте</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isNew}
                  onChange={(event) => setField("isNew", event.target.checked)}
                />
                <span>Новинка</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isPopular}
                  onChange={(event) =>
                    setField("isPopular", event.target.checked)
                  }
                />
                <span>Показывать в блоке «Популярные»</span>
              </label>
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
              type="submit"
              disabled={busy || uploading || Boolean(variantUploadingId)}
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
            Импортированные товары создаются черновиками. Перед публикацией проверьте
            описание, изображение, цену и категорию.
          </p>
        </form>
      </div>

      <div className="space-y-3 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Товары</h2>
          <span className="text-sm text-gray-500">
            {searchQuery.trim() ? filteredItems.length + " из " + items.length : items.length + " поз."}
          </span>
        </div>

        <div className="flex gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Поиск: название, бренд, SKU, объём…"
            className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-500"
          />
          {searchQuery && (
            <button
              type="button"
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => setSearchQuery("")}
            >
              Очистить
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {filteredItems.map((product) => {
            const variantsCount = Array.isArray(product.variants)
              ? product.variants.length
              : 0;

            return (
              <div
                key={product.id}
                className="rounded-2xl border p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 min-w-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-16 h-16 object-cover rounded-lg shrink-0"
                  />

                  <div className="min-w-0">
                    <div className="font-semibold flex flex-wrap items-center gap-2">
                      <span className="break-words">{product.name}</span>
                      {!product.isPublished && (
                        <Badge className="bg-gray-100 text-gray-700 border-gray-200">
                          Черновик
                        </Badge>
                      )}
                      {product.isNew && (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                          Новинка
                        </Badge>
                      )}
                      {product.isPopular && (
                        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
                          Популярный
                        </Badge>
                      )}
                      {variantsCount > 0 && (
                        <Badge className="bg-gray-100 text-gray-700">
                          Вариантов: {variantsCount}
                        </Badge>
                      )}
                    </div>

                    <div className="text-sm text-gray-500 break-words">
                      {product.brand?.name || "—"} •{" "}
                      {Number(product.price).toLocaleString("ru-RU")} ₸ •{" "}
                      {product.stock} шт.
                    </div>
                    {(product.supplierSku || product.supplier?.name) && (
                      <div className="text-xs text-gray-400 mt-1">
                        {product.supplier?.name || "Поставщик"}
                        {product.supplierSku ? ` • SKU ${product.supplierSku}` : ""}
                        {product.sourcePrice != null
                          ? ` • прайс ${Number(product.sourcePrice).toLocaleString("ru-RU")} ₸`
                          : ""}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:flex-nowrap sm:justify-end">
                  <button className="btn" onClick={() => edit(product)} type="button">
                    Ред.
                  </button>
                  <button className="btn" onClick={() => remove(product.id)} type="button">
                    Удалить
                  </button>
                </div>
              </div>
            );
          })}

          {filteredItems.length === 0 && (
            <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
              {items.length === 0 ? "Пока пусто" : "По запросу «" + searchQuery.trim() + "» ничего не найдено"}
            </div>
          )}
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

function Badge({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${className}`}
    >
      {children}
    </span>
  );
}
