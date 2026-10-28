"use client";
import { productDisplayName } from "@/lib/productNames";
import { productMatchesSearch } from "@/lib/productSearch";
import ProductFiltersBar from "./ProductFiltersBar";
import dynamic from "next/dynamic";
import ListLoadStatus from "@/components/ListLoadStatus";
import useProgressiveList from "@/components/useProgressiveList";
import { ADMIN_PRODUCT_BATCH_SIZE } from "@/lib/progressiveList";
import { productThumbnail } from "@/lib/productThumbnails";

const ProductAssistant = dynamic(() => import("./ProductAssistant"), {
  loading: () => <p role="status" className="text-sm text-gray-500">Загрузка ИИ-инструментов…</p>,
});
import ProductPriceSources from "./ProductPriceSources";
import ProductSelectionBar from "./ProductSelectionBar";
import { requestProductActions } from "./productActions";
import {
  PRODUCT_EDITOR_EVENT,
  type ProductEditorRequest,
} from "./productEditorEvents";
import type {
  ProductAction,
  ProductActionResult,
} from "@/lib/adminProductActions";
import {
  emptyProductFilters,
  productMatchesFilters,
  selectedVisibleProducts,
  type ProductFilters,
} from "@/lib/adminProductFilters";
import {
  VariantPhotoPreview,
  VariantPhotoPicker,
} from "@/components/VariantPhotoPicker";
import { photoSku } from "@/lib/enrichment/variantImages";
import { isUsablePhoto } from "@/lib/enrichment/photoQuality";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ProductVariantsPanel, { VariantSummary } from "./ProductVariantsPanel";
import { adminStockSummary } from "../../../../lib/adminProductVariants";

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

import type { Product } from "./productTypes";

const emptyForm = {
  name: "",
  brandId: "",
  shortDescription: "",
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
    const variant = raw && typeof raw === "object" ? (raw as VariantData) : {};

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
  return response.json().catch(() => ({}) as Record<string, unknown>);
}

export default function AdminProductsClient() {
  const [items, setItems] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toolBusy, setToolBusy] = useState(false);
  const [assistantVersion, setAssistantVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [variantUploadingId, setVariantUploadingId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchPending = searchQuery !== deferredSearchQuery;
  const [filters, setFilters] = useState<ProductFilters>({
    ...emptyProductFilters,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [actionFailures, setActionFailures] = useState<
    ProductActionResult["failures"]
  >([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const editorFormId = useId();
  const variantsRef = useRef<HTMLDivElement>(null);
  const assistantRef = useRef<HTMLDivElement>(null);
  const openingSection = useRef<"details" | "variants" | "assistant">(
    "details",
  );
  const initialForm = useRef(JSON.stringify(emptyForm));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!editorOpen || !dialog) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (openingSection.current === "variants")
      variantsRef.current?.scrollIntoView({ block: "start" });
    else if (openingSection.current === "assistant")
      assistantRef.current?.scrollIntoView({ block: "start" });
    else editorScrollRef.current?.scrollTo({ top: 0 });
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [editorOpen]);

  function closeEditor() {
    if (busy || toolBusy || uploading || variantUploadingId) return;
    if (
      JSON.stringify(form) !== initialForm.current &&
      !window.confirm("Закрыть карточку без сохранения изменений?")
    )
      return;
    setEditorOpen(false);
    setEditing(null);
    setForm(emptyForm);
  }

  async function load() {
    const productResponse = await fetch("/api/products", { cache: "no-store" });
    if (productResponse.ok) {
      const products = (await productResponse.json()) as Product[];
      setItems(products);
      const activeIds = new Set(products.map((product) => product.id));
      setSelectedIds((current) => current.filter((id) => activeIds.has(id)));
    }
  }

  useEffect(() => {
    void load();
    void fetch("/api/brands", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) setBrands(await response.json());
      })
      .catch(() =>
        setMsg("Не удалось загрузить список брендов. Обновите страницу."),
      );

    const onProductsChanged = () => void load();
    const onSearch = (event: Event) => {
      const value = (event as CustomEvent<string>).detail || "";
      setSearchQuery(value);
      setSelectedIds([]);
    };

    const savedSearch =
      window.sessionStorage.getItem("admin-product-search") || "";
    setSearchQuery(savedSearch);

    window.addEventListener("products-changed", onProductsChanged);
    window.addEventListener("admin-product-search", onSearch);
    return () => {
      window.removeEventListener("products-changed", onProductsChanged);
      window.removeEventListener("admin-product-search", onSearch);
    };
    // load intentionally remains a local request helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      next[index] = {
        ...row,
        ...patch,
        ...(patch.sku !== undefined && photoSku(patch.sku) !== photoSku(row.sku)
          ? { image: "" }
          : {}),
      };
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
    const data = (await readJson(response)) as {
      url?: unknown;
      error?: unknown;
    };

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

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || toolBusy || uploading || variantUploadingId) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const publishNow =
      submitter instanceof HTMLButtonElement && submitter.value === "publish";
    if (
      form.variants.some(
        (row) => !row.label.trim() || row.price === "" || row.stock === "",
      )
    ) {
      setMsg(
        "Заполните объём, цену и остаток каждого варианта или удалите пустую строку.",
      );
      variantsRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
      return;
    }
    setBusy(true);
    setPublishing(publishNow);
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
      shortDescription: form.shortDescription.trim() || null,
      description: form.description.trim(),
      image: form.image.trim(),
      category: form.category.trim(),
      price: Math.max(0, Math.trunc(Number(form.price) || 0)),
      stock: Math.max(0, Math.trunc(Number(form.stock) || 0)),
      isPopular: form.isPopular,
      isNew: form.isNew,
      isPublished: publishNow || form.isPublished,
      ...(publishNow ? { publishNow: true } : {}),
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
      const data = (await readJson(response)) as Product & {
        error?: unknown;
        message?: unknown;
      };

      if (!response.ok) {
        throw new Error(String(data.message || data.error || response.status));
      }

      setItems((current) => [
        ...current.filter((product) => product.id !== data.id),
        {
          ...data,
          priceSources: current.find((product) => product.id === data.id)
            ?.priceSources,
        },
      ]);
      if (publishNow) {
        setEditorOpen(false);
        setEditing(null);
        setForm(emptyForm);
        initialForm.current = JSON.stringify(emptyForm);
      } else {
        edit(data);
        setAssistantVersion((current) => current + 1);
      }
      setMsg(
        publishNow
          ? "Товар сохранён и опубликован на сайте"
          : editing
            ? "Товар обновлён"
            : "Товар добавлен",
      );
      window.dispatchEvent(new Event("products-changed"));
    } catch (error: any) {
      setMsg(`Ошибка: ${error?.message || "save_failed"}`);
    } finally {
      setBusy(false);
      setPublishing(false);
    }
  }

  const edit = useCallback((
    product: Product,
    section: "details" | "variants" | "assistant" = "details",
  ) => {
    setEditing(product.id);
    const nextForm = {
      name: productDisplayName(product),
      brandId: product.brandId || "",
      shortDescription: String(product.shortDescription || ""),
      description: String(product.description || ""),
      image: product.image || "/seed/cleanser.jpg",
      category: product.category || "",
      price: String(Math.trunc(Number(product.price) || 0)),
      stock: String(Math.trunc(Number(product.stock) || 0)),
      isPopular: Boolean(product.isPopular),
      isNew: Boolean(product.isNew),
      isPublished: Boolean(product.isPublished),
      variants: parseVariantRows(product.variants),
    };
    initialForm.current = JSON.stringify(nextForm);
    openingSection.current = section;
    setForm(nextForm);
    setMsg(null);
    setEditorOpen(true);
  }, []);

  function addProduct() {
    setEditing(null);
    setForm(emptyForm);
    initialForm.current = JSON.stringify(emptyForm);
    openingSection.current = "details";
    setMsg(null);
    setEditorOpen(true);
  }

  function assistantSaved(product: Product, mergedIds: string[] = []) {
    const published =
      !mergedIds.length && product.isPublished &&
      !items.find((row) => row.id === product.id)?.isPublished;
    setItems((current) => [
      ...current.filter(
        (row) => row.id !== product.id && !mergedIds.includes(row.id),
      ),
      product,
    ]);
    edit(product);
    setAssistantVersion((current) => current + 1);
    setMsg(
      published
        ? "Товар сохранён и опубликован на сайте"
        : mergedIds.length
          ? "Карточки объединены. Проверьте варианты ниже."
          : "Данные применены. Можно отредактировать текст в полях ниже.",
    );
    window.dispatchEvent(new Event("products-changed"));
  }

  const editingProduct = items.find((product) => product.id === editing);
  const dirty = JSON.stringify(form) !== initialForm.current;

  useEffect(() => {
    const openRequestedProduct = (event: Event) => {
      const request = (event as CustomEvent<ProductEditorRequest>).detail;
      if (!request?.product?.id) return;
      if (busy || toolBusy || uploading || variantUploadingId || bulkBusy)
        return;
      if (
        editorOpen &&
        dirty &&
        !window.confirm("Открыть другой товар без сохранения изменений?")
      )
        return;
      setItems((current) => [
        ...current.filter((product) => product.id !== request.product.id),
        request.product,
      ]);
      edit(request.product, request.section);
      setAssistantVersion((current) => current + 1);
    };
    window.addEventListener(PRODUCT_EDITOR_EVENT, openRequestedProduct);
    return () =>
      window.removeEventListener(PRODUCT_EDITOR_EVENT, openRequestedProduct);
  }, [
    busy,
    toolBusy,
    uploading,
    variantUploadingId,
    bulkBusy,
    editorOpen,
    dirty,
  ]);

  const filteredItems = useMemo(
    () =>
      items.filter(
        (product) =>
          productMatchesSearch(product, deferredSearchQuery) &&
          productMatchesFilters(product, filters),
      ),
    [items, deferredSearchQuery, filters],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedProducts = useMemo(() => selectedVisibleProducts(filteredItems, selectedSet), [filteredItems, selectedSet]);
  const list = useProgressiveList(filteredItems, ADMIN_PRODUCT_BATCH_SIZE, JSON.stringify([deferredSearchQuery, filters]));

  const actOnProducts = useCallback(async (
    action: ProductAction,
    products = selectedProducts,
  ) => {
    if (!products.length || bulkBusy || editorOpen || searchPending) return;
    const confirmation =
      action === "delete"
        ? `Удалить товаров: ${products.length}? Карточки и их варианты будут удалены без возможности восстановления.`
        : `Снять с публикации товаров: ${products.length}? Карточки сохранятся в черновиках.`;
    if (!window.confirm(confirmation)) return;
    setBulkBusy(true);
    setBulkProgress(`Обработано: 0 из ${products.length}`);
    setActionFailures([]);
    setMsg(null);
    try {
      const result = await requestProductActions(action, products, (done) =>
        setBulkProgress(`Обработано: ${done} из ${products.length}`),
      );
      const processed = new Set(result.processedIds);
      setItems((current) =>
        action === "delete"
          ? current.filter((product) => !processed.has(product.id))
          : current.map((product) =>
              processed.has(product.id)
                ? { ...product, isPublished: false }
                : product,
            ),
      );
      setSelectedIds(result.failures.map((failure) => failure.id));
      setActionFailures(result.failures);
      setMsg(
        `${action === "delete" ? "Удалено" : "Снято с публикации"}: ${result.processedIds.length} из ${products.length}.${result.failures.length ? " Необработанные товары оставлены выбранными." : ""}`,
      );
      window.dispatchEvent(new Event("products-changed"));
    } finally {
      setBulkBusy(false);
    }
  }, [selectedProducts, bulkBusy, editorOpen, searchPending]);

  const filterOptions = useMemo(
    () => ({
      categories: [
        ...new Map(
          items
            .filter((p) => p.category.trim())
            .map((p) => [
              p.category.trim().toLocaleLowerCase("ru-RU"),
              {
                value: p.category.trim().toLocaleLowerCase("ru-RU"),
                label: p.category.trim(),
              },
            ]),
        ).values(),
      ].sort((a, b) => a.label.localeCompare(b.label, "ru")),
      suppliers: [
        ...new Map(
          items.flatMap((p) =>
            p.supplier ? [[p.supplier.id, p.supplier] as const] : [],
          ),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name, "ru")),
      priceSources: [
        ...new Map(
          items.flatMap((product) =>
            (product.priceSources || []).map(
              (source) =>
                [
                  source.importId,
                  {
                    id: source.importId,
                    name: `${source.fileName}${source.sourceDate ? ` · ${new Date(source.sourceDate).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" })}` : ""}`,
                  },
                ] as const,
            ),
          ),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name, "ru")),
      counts: {
        all: items.length,
        draft: items.filter((p) => !p.isPublished).length,
        published: items.filter((p) => p.isPublished).length,
      },
    }),
    [items],
  );

  const productRows = useMemo(
    () => list.items.map((product) => {
      const { variants } = adminStockSummary(product);
      const variantsCount = variants.length;
      const prices = variants.map((row) => row.price);
      const minPrice = prices.length
        ? Math.min(...prices)
        : Number(product.price);
      const maxPrice = prices.length ? Math.max(...prices) : minPrice;

      return (
        <div
          key={product.id}
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 240px" }}
          className={`min-w-0 rounded-2xl border bg-white p-4 ${selectedSet.has(product.id) ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]" : ""}`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                aria-label={`Выбрать ${product.name}`}
                checked={selectedSet.has(product.id)}
                onChange={() =>
                  setSelectedIds((current) =>
                    current.includes(product.id)
                      ? current.filter((id) => id !== product.id)
                      : [...current, product.id],
                  )
                }
              />
              <VariantPhotoPreview
                src={productThumbnail(product.image, 160)}
                alt={product.name}
                className="h-16 w-16 shrink-0 rounded-lg bg-gray-50 object-contain"
              />

              <div className="min-w-0">
                <div className="font-semibold flex flex-wrap items-center gap-2">
                  <span className="break-words">{productDisplayName(product)}</span>
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
                    <Badge
                      className="bg-yellow-100 text-yellow-800 border-yellow-200"
                      title={product.popularityReason || undefined}
                    >
                      {product.popularityPinned
                        ? "Популярный · вручную"
                        : `Популярный · сеть ${Math.trunc(Number(product.popularityScore) || 0)}%`}
                    </Badge>
                  )}
                </div>

                <div className="text-sm text-gray-500 break-words">
                  {product.brand?.name || "—"} •{" "}
                  {minPrice.toLocaleString("ru-RU")}
                  {maxPrice > minPrice
                    ? `–${maxPrice.toLocaleString("ru-RU")}`
                    : ""}{" "}
                  ₸
                </div>
                <VariantSummary product={product} />
                {(product.supplierSku || product.supplier?.name) && (
                  <div className="text-xs text-gray-400 mt-1">
                    {product.supplier?.name || "Поставщик"}
                    {product.supplierSku
                      ? ` • SKU ${product.supplierSku}`
                      : ""}
                    {product.sourcePrice != null
                      ? ` • цена в прайсе ${Number(product.sourcePrice).toLocaleString("ru-RU")} ₸`
                      : ""}
                  </div>
                )}
                <ProductPriceSources sources={product.priceSources} />
              </div>
            </div>

            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:max-w-sm sm:shrink-0 sm:justify-end">
              <button
                className="btn"
                onClick={() => edit(product)}
                type="button"
              >
                Редактировать
              </button>
              {!isUsablePhoto(product.image) && (
                <button
                  className="btn-secondary"
                  onClick={() => edit(product, "assistant")}
                  type="button"
                >
                  Найти фото / ИИ
                </button>
              )}
              <button
                className="btn-secondary"
                onClick={() => void actOnProducts("delete", [product])}
                type="button"
              >
                Удалить
              </button>
            </div>
          </div>
          <ProductVariantsPanel
            product={product}
            onEdit={() => edit(product, "variants")}
            onSaved={() =>
              window.dispatchEvent(new Event("products-changed"))
            }
          />
        </div>
      );
    }),
    [list.items, selectedSet, edit, actOnProducts],
  );

  return (
    <div className="space-y-4">
      <dialog
        ref={dialogRef}
        aria-labelledby="product-editor-title"
        className="m-0 h-[100dvh] max-h-[100dvh] w-full max-w-none overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)] p-0 shadow-xl backdrop:bg-black/40 sm:m-auto sm:h-[90dvh] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-4xl sm:rounded-2xl"
        onCancel={(event) => {
          event.preventDefault();
          closeEditor();
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 sm:gap-3 sm:px-6 sm:py-4">
            <div className="min-w-0">
              <h2 id="product-editor-title" className="truncate text-base font-semibold sm:text-xl">
                {editing ? "Редактировать товар" : "Добавить товар"}
              </h2>
              {editing && (
                <p className="mt-0.5 flex max-w-xl items-center gap-2 text-xs text-gray-500 sm:mt-1 sm:text-sm">
                  <span className="truncate">{form.name}</span>
                  {editingProduct && <span className="shrink-0 text-[10px] sm:hidden">
                    {editingProduct.isPublished ? "Опубликован" : "Черновик"}
                  </span>}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={
                busy || toolBusy || uploading || Boolean(variantUploadingId)
              }
              aria-label="Закрыть редактор"
              className="btn-secondary h-10 w-10 shrink-0 p-0 disabled:opacity-50 sm:w-auto sm:px-4 sm:py-2"
              onClick={closeEditor}
            >
              <span aria-hidden="true" className="text-2xl leading-none sm:hidden">×</span>
              <span className="hidden sm:inline">Закрыть</span>
            </button>
            <nav
              aria-label="Разделы карточки"
              className="col-span-2 flex w-full gap-1 overflow-x-auto sm:gap-2"
            >
              <button
                type="button"
                className="btn-secondary min-h-10 flex-1 whitespace-nowrap px-2 py-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
                onClick={() =>
                  editorScrollRef.current?.scrollTo({
                    top: 0,
                    behavior: "smooth",
                  })
                }
              >
                <span className="sm:hidden">Данные</span><span className="hidden sm:inline">Данные товара</span>
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn-secondary min-h-10 flex-1 whitespace-nowrap px-2 py-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
                  onClick={() =>
                    assistantRef.current?.scrollIntoView({
                      block: "start",
                      behavior: "smooth",
                    })
                  }
                >
                  ИИ и дубли
                </button>
              )}
              <button
                type="button"
                className="btn-secondary min-h-10 flex-1 whitespace-nowrap px-2 py-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
                onClick={() =>
                  variantsRef.current?.scrollIntoView({
                    block: "start",
                    behavior: "smooth",
                  })
                }
              >
                Варианты ({form.variants.length})
              </button>
            </nav>
          </div>

          <div
            ref={editorScrollRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
          >
            {editingProduct && (
              <ProductPriceSources sources={editingProduct.priceSources} />
            )}
            {editorOpen && editingProduct && (
              <div ref={assistantRef} className="scroll-mt-4">
                <ProductAssistant
                  key={editingProduct.id + ":" + assistantVersion}
                  product={editingProduct}
                  dirty={dirty}
                  disabled={busy || uploading || Boolean(variantUploadingId)}
                  onBusyChange={setToolBusy}
                  onSaved={assistantSaved}
                />
              </div>
            )}
            {!editing && (
              <p className="text-xs text-gray-500">
                Сохраните товар, чтобы открыть инструменты поиска и объединения.
              </p>
            )}
            <form id={editorFormId} className="space-y-3" onSubmit={save}>
              <fieldset
                disabled={
                  busy || toolBusy || uploading || Boolean(variantUploadingId)
                }
                className="space-y-3"
              >
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
                    onChange={(event) =>
                      setField("brandId", event.target.value)
                    }
                  >
                    <option value="">— без бренда —</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Краткое описание">
                  <textarea
                    rows={3}
                    maxLength={280}
                    className="w-full border rounded-xl px-3 py-2"
                    placeholder="Что это за средство, для какой кожи или задачи и 2–3 главных преимущества"
                    value={form.shortDescription}
                    onChange={(event) =>
                      setField("shortDescription", event.target.value)
                    }
                  />
                  <div className="mt-1 text-xs text-gray-500">
                    До 280 символов. Используется в карточке товара и
                    метаописании.
                  </div>
                </Field>

                <Field label="Полное описание">
                  <textarea
                    required
                    rows={10}
                    className="w-full border rounded-xl px-3 py-2"
                    value={form.description}
                    onChange={(event) =>
                      setField("description", event.target.value)
                    }
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
                    <VariantPhotoPreview
                      src={form.image}
                      alt="Предпросмотр товара"
                      className="h-20 w-20 rounded-xl border bg-gray-50 object-contain"
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
                    onChange={(event) =>
                      setField("category", event.target.value)
                    }
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
                        setField(
                          "price",
                          event.target.value.replace(/[^\d]/g, ""),
                        )
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
                      readOnly={form.variants.length > 0}
                      value={
                        form.variants.length
                          ? form.variants.reduce(
                              (sum, row) => sum + (Number(row.stock) || 0),
                              0,
                            )
                          : form.stock
                      }
                      onChange={(event) =>
                        setField(
                          "stock",
                          event.target.value.replace(/[^\d]/g, ""),
                        )
                      }
                    />
                    {form.variants.length > 0 && (
                      <p className="text-xs text-gray-500">
                        Сумма остатков вариантов, рассчитывается автоматически.
                      </p>
                    )}
                  </Field>
                </div>

                <div
                  ref={variantsRef}
                  className="scroll-mt-4 rounded-2xl border bg-gray-50 p-3 sm:p-4"
                >
                  <h3 className="mb-3 text-lg font-semibold">
                    Варианты · {form.variants.length}
                  </h3>
                  <p className="mb-3 text-sm text-gray-500">
                    Для каждого объёма укажите цену и остаток. Общее количество
                    считается автоматически. Фото подбирается по SKU; без
                    отдельного фото используется общее. При смене SKU прежнее
                    фото варианта сбрасывается.
                  </p>
                  <div className="space-y-3">
                    {form.variants.map((variant, index) => {
                      const preview =
                        String(variant.image || "").trim() ||
                        form.image ||
                        "/seed/cleanser.jpg";
                      const uploadingThis = variantUploadingId === variant.id;
                      const ownImage = String(variant.image || "").trim();
                      const isPrimary =
                        isUsablePhoto(ownImage) &&
                        form.image.trim() === ownImage;

                      return (
                        <div
                          key={variant.id}
                          className="rounded-2xl border p-3 space-y-3"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                            <input
                              className="md:col-span-3 border rounded-xl px-3 py-2"
                              placeholder="Напр. 50 мл"
                              aria-label={`Объём варианта ${index + 1}`}
                              value={variant.label}
                              onChange={(event) =>
                                setVariantRow(index, {
                                  label: event.target.value,
                                })
                              }
                            />
                            <input
                              className="md:col-span-2 border rounded-xl px-3 py-2"
                              placeholder="Цена ₸"
                              aria-label={`Цена варианта ${index + 1}`}
                              inputMode="numeric"
                              value={variant.price}
                              onChange={(event) =>
                                setVariantRow(index, {
                                  price: event.target.value.replace(
                                    /[^\d]/g,
                                    "",
                                  ),
                                })
                              }
                            />
                            <input
                              className="md:col-span-2 border rounded-xl px-3 py-2"
                              placeholder="Остаток"
                              aria-label={`Остаток варианта ${index + 1}`}
                              inputMode="numeric"
                              value={variant.stock}
                              onChange={(event) =>
                                setVariantRow(index, {
                                  stock: event.target.value.replace(
                                    /[^\d]/g,
                                    "",
                                  ),
                                })
                              }
                            />
                            <input
                              className="md:col-span-2 border rounded-xl px-3 py-2"
                              placeholder="SKU"
                              aria-label={`SKU варианта ${index + 1}`}
                              value={variant.sku || ""}
                              onChange={(event) =>
                                setVariantRow(index, {
                                  sku: event.target.value,
                                })
                              }
                            />
                            <input
                              className="md:col-span-3 border rounded-xl px-3 py-2"
                              placeholder="Фото варианта"
                              aria-label={`Фото варианта ${index + 1}`}
                              value={variant.image || ""}
                              onChange={(event) =>
                                setVariantRow(index, {
                                  image: event.target.value,
                                })
                              }
                            />
                          </div>

                          {editing && (
                            <VariantPhotoPicker
                              key={variant.id + ":" + variant.sku}
                              productId={editing}
                              variant={variant}
                              commonImage={form.image}
                              disabled={busy || toolBusy || uploadingThis}
                              onBusyChange={setToolBusy}
                              value={{
                                variantId: variant.id,
                                sku: variant.sku || "",
                                imageUrl: variant.image || null,
                              }}
                              onChange={(selection) => {
                                if (selection)
                                  setVariantRow(index, {
                                    image: selection.imageUrl || "",
                                  });
                              }}
                            />
                          )}
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <VariantPhotoPreview
                                src={preview}
                                fallback={form.image}
                                alt="Предпросмотр варианта"
                                className="h-12 w-12 rounded-xl border bg-gray-50 object-contain"
                              />
                              <span className="text-xs text-gray-500">
                                {variant.image
                                  ? "Фото варианта"
                                  : "Основное фото"}
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn-secondary min-h-10 px-3 py-2 text-sm disabled:opacity-50"
                                disabled={
                                  !isUsablePhoto(ownImage) || uploadingThis
                                }
                                aria-pressed={isPrimary}
                                aria-label={`Сделать фото варианта ${variant.label || index + 1}${variant.sku ? ` (SKU ${variant.sku})` : ""} главным`}
                                onClick={() => {
                                  setField("image", ownImage);
                                  setMsg(
                                    "Главное фото выбрано. Нажмите «Сохранить», чтобы применить его к товару.",
                                  );
                                }}
                              >
                                {isPrimary ? "Главное фото" : "Сделать главным"}
                              </button>
                              <label className="inline-flex items-center px-3 py-2 rounded-xl border hover:bg-gray-50 cursor-pointer text-sm">
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  disabled={uploadingThis}
                                  onChange={(event) => {
                                    const selectedFile =
                                      event.target.files?.[0];
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
                </div>

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
                        onChange={(event) =>
                          setField("isNew", event.target.checked)
                        }
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
              </fieldset>

              <p className="text-xs text-gray-500">
                Импортированные товары создаются черновиками. Перед публикацией
                проверьте описание, изображение, цену и категорию.
              </p>
            </form>
          </div>
          <div className="shrink-0 space-y-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:space-y-3 sm:px-6 sm:pt-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
            {msg && (
              <div
                role="status"
                className="max-h-10 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs leading-4 sm:max-h-24 sm:rounded-xl sm:p-3 sm:text-sm"
              >
                {msg}
              </div>
            )}
            <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap sm:gap-3">
              <button
                className={
                  (editingProduct && !editingProduct.isPublished
                    ? "btn-secondary"
                    : "btn") +
                  " min-h-11 min-w-0 px-2 py-2 text-xs sm:max-w-full sm:px-4 sm:text-sm disabled:cursor-not-allowed disabled:opacity-50" +
                  (!(editingProduct && !editingProduct.isPublished) ? " col-span-2" : "")
                }
                type="submit"
                form={editorFormId}
                name="intent"
                value="save"
                disabled={
                  busy || toolBusy || uploading || Boolean(variantUploadingId)
                }
              >
                {busy ? "Сохранение…" : uploading ? "Загрузка…" : "Сохранить"}
              </button>

              {editingProduct && !editingProduct.isPublished && (
                <button
                  type="submit"
                  form={editorFormId}
                  name="intent"
                  value="publish"
                  aria-label={publishing ? "Публикация…" : "Сохранить и опубликовать"}
                  disabled={
                    busy || toolBusy || uploading || Boolean(variantUploadingId)
                  }
                  className="btn min-h-11 min-w-0 px-2 py-2 text-xs sm:max-w-full sm:px-4 sm:text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publishing ? "Публикация…" : <><span className="sm:hidden">Опубликовать</span><span className="hidden sm:inline">Сохранить и опубликовать</span></>}
                </button>
              )}

              {editingProduct && (
                <span
                  className={
                    "hidden rounded-full px-3 py-1 text-xs sm:inline-flex " +
                    (editingProduct.isPublished
                      ? "accent-badge"
                      : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]")
                  }
                >
                  {editingProduct.isPublished ? "Опубликован" : "Черновик"}
                </span>
              )}

              <button
                type="button"
                className="btn-secondary hidden min-h-11 max-w-full px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
                disabled={
                  busy || toolBusy || uploading || Boolean(variantUploadingId)
                }
                onClick={closeEditor}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      </dialog>

      <div className="space-y-3 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Товары</h2>
            <p className="mt-1 text-sm text-gray-500">
              Карточки, варианты и остатки в одном списке.
            </p>
          </div>
          <button
            type="button"
            className="btn shrink-0"
            disabled={bulkBusy}
            onClick={addProduct}
          >
            + Добавить товар
          </button>
        </div>
        <fieldset disabled={bulkBusy} className="min-w-0">
          <ProductFiltersBar
            value={filters}
            onChange={(value) => {
              setFilters(value);
              setSelectedIds([]);
            }}
            brands={brands}
            {...filterOptions}
          />
        </fieldset>
        <ProductSelectionBar
          total={filteredItems.length}
          selected={selectedProducts.length}
          busy={bulkBusy || searchPending}
          progress={bulkProgress}
          onSelectAll={() =>
            setSelectedIds(filteredItems.map((product) => product.id))
          }
          onClear={() => setSelectedIds([])}
          onAction={(action) => void actOnProducts(action)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-gray-500">
            Найдено: {filteredItems.length} из {items.length}
          </span>
        </div>
        {!editorOpen && msg && (
          <p role="status" className="rounded-xl border bg-white p-3 text-sm">
            {msg}
          </p>
        )}
        {actionFailures.length > 0 && (
          <div
            role="alert"
            className="max-h-60 overflow-y-auto rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <ul className="space-y-1">
              {actionFailures.map((failure) => {
                const product = items.find((item) => item.id === failure.id);
                return (
                  <li
                    key={failure.id}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span>
                      {failure.name}: {failure.message}
                    </span>
                    {product && (
                      <button
                        type="button"
                        className="btn-secondary px-3 py-1 text-xs"
                        disabled={bulkBusy}
                        onClick={() => edit(product)}
                      >
                        Открыть товар
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <fieldset
          aria-busy={searchPending}
          disabled={bulkBusy || searchPending}
          className="grid min-w-0 scroll-mt-36 grid-cols-1 gap-3"
        >
          {productRows}

          {filteredItems.length === 0 && (
            <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
              {items.length === 0
                ? "Пока пусто"
                : "По выбранным фильтрам и поиску ничего не найдено"}
            </div>
          )}
        </fieldset>
        <ListLoadStatus count={list.count} total={list.total} endRef={list.endRef} onRevealAll={list.revealAll} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const content = Children.map(children, (child) =>
    isValidElement<{ id?: string }>(child) &&
    typeof child.type === "string" &&
    ["input", "select", "textarea"].includes(child.type)
      ? cloneElement(child, { id })
      : child,
  );
  return (
    <div className="space-y-1 min-w-0">
      <label htmlFor={id} className="block text-sm text-gray-600">
        {label}
      </label>
      {content}
    </div>
  );
}

function Badge({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${className}`}
    >
      {children}
    </span>
  );
}
