"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type Tab = "products" | "proposals" | "sources";
type ApplyMode = "ALL" | "DESCRIPTION" | "IMAGE";

type Product = {
  id: string;
  name: string;
  supplierSku: string | null;
  image: string;
  description: string;
  isPublished: boolean;
  enrichmentStatus: string;
  brand: { id: string; name: string } | null;
  supplier: { id: string; name: string; slug: string } | null;
  sources: Array<{
    id: string;
    url: string;
    title: string | null;
    status: string;
    lastCheckedAt: string | null;
    lastChangedAt: string | null;
  }>;
  enrichmentJobs: Array<{
    id: string;
    status: string;
    error: string | null;
    sourceUrl: string | null;
    createdAt: string;
    finishedAt: string | null;
  }>;
  enrichmentProposals: Array<{
    id: string;
    confidence: number;
    sourceUrl: string;
    createdAt: string;
  }>;
};

type Proposal = {
  id: string;
  status: string;
  sourceUrl: string;
  confidence: number;
  title: string | null;
  shortDescription: string | null;
  description: string | null;
  application: string | null;
  ingredients: string | null;
  images: unknown;
  facts: unknown;
  warnings: unknown;
  createdAt: string;
  product: {
    id: string;
    name: string;
    supplierSku: string | null;
    image: string;
    description: string;
    stock: number;
    variants: unknown;
    isPublished: boolean;
    enrichmentStatus: string;
    brand: { name: string } | null;
    supplier: { id: string; name: string; slug: string } | null;
  };
  source: {
    id: string;
    url: string;
    canonicalUrl: string | null;
    title: string | null;
    lastCheckedAt: string | null;
    lastChangedAt: string | null;
    status: string;
  } | null;
  job: {
    id: string;
    status: string;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
};

type SupplierSource = {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  sourceType: string;
  isEnabled: boolean;
  allowSubdomains: boolean;
  priority: number;
  selectors: unknown;
  _count: { productSources: number };
};

type SupplierGroup = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sources: SupplierSource[];
};

type SourceForm = {
  supplierId: string;
  name: string;
  domain: string;
  baseUrl: string;
  priority: string;
  allowSubdomains: boolean;
};

const emptySourceForm: SourceForm = {
  supplierId: "",
  name: "",
  domain: "",
  baseUrl: "",
  priority: "0",
  allowSubdomains: true,
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

type ProposalVariant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
};

function proposalVariants(value: unknown): ProposalVariant[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return {
        id: String(row.id || ""),
        label: String(row.label || ""),
        price: Math.max(0, Math.trunc(Number(row.price) || 0)),
        stock: Math.max(0, Math.trunc(Number(row.stock) || 0)),
        sku: row.sku ? String(row.sku) : undefined,
      };
    })
    .filter((variant) => variant.id && variant.label);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
}

function isSourceRequiredError(value: string | null | undefined) {
  return [
    "official_page_not_found",
    "official_page_not_found_after_stale_source",
    "product_page_not_found",
    "product_page_not_found_after_stale_source",
    "product_match_zero_confidence",
  ].includes(String(value || "").trim());
}

function enrichmentErrorText(value: string) {
  if (value === "official_page_not_found") {
    return "Официальная карточка товара не найдена. Возможно, позиция снята с текущего каталога.";
  }
  if (value === "official_page_not_found_after_stale_source") {
    return "Старый официальный адрес больше не работает, а новая карточка товара не найдена.";
  }
  if (value === "product_page_not_found") {
    return "Карточка товара не найдена ни на официальном сайте, ни у проверяемых продавцов.";
  }
  if (value === "product_page_not_found_after_stale_source") {
    return "Старый адрес больше не работает, а новая карточка не найдена ни на официальном сайте, ни у проверяемых продавцов.";
  }
  if (value === "product_match_zero_confidence") {
    return "Найденная карточка не совпадает с товаром. Предложение с совпадением 0% не создано; укажите точный URL или повторите поиск.";
  }
  return value;
}

function statusLabel(value: string) {
  return value.toUpperCase() === "SOURCE_REQUIRED" ? "Нужен источник" : value;
}

function statusClass(status: string) {
  const normalized = status.toUpperCase();
  if (["READY", "APPLIED", "ACTIVE"].includes(normalized)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (["REVIEW", "PENDING", "RUNNING", "SOURCE_REQUIRED"].includes(normalized)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (["FAILED", "ERROR", "BLOCKED", "UNAVAILABLE"].includes(normalized)) {
    return "border-red-200 bg-red-50 text-red-800";
  }
  return "border-gray-200 bg-gray-50 text-gray-700";
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${statusClass(value)}`}>
      {statusLabel(value)}
    </span>
  );
}

type ImageStatus = "loading" | "loaded" | "error";

function SelectableImage({
  src,
  selected,
  proposalId,
  index,
  onSelect,
}: {
  src: string;
  selected: boolean;
  proposalId: string;
  index: number;
  onSelect: () => void;
}) {
  const [status, setStatus] = useState<ImageStatus>("loading");

  useEffect(() => {
    setStatus("loading");
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "error" : current));
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [src]);

  const canSelect = status === "loaded";

  return (
    <label
      className={`relative rounded-xl border p-2 transition ${
        selected
          ? "border-black ring-2 ring-black"
          : canSelect
            ? "cursor-pointer hover:border-gray-500"
            : "cursor-not-allowed border-gray-200"
      }`}
    >
      <input
        type="radio"
        className="sr-only"
        name={`proposal-image-${proposalId}`}
        checked={selected}
        disabled={!canSelect}
        onChange={onSelect}
      />

      <div className="relative aspect-square overflow-hidden rounded-lg bg-gray-50">
        {status === "loading" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-gray-50 text-xs text-gray-500">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
            Загрузка фото…
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50 px-3 text-center text-xs text-red-700">
            Фото недоступно
          </div>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`Вариант изображения ${index + 1}`}
          className={`h-full w-full object-contain transition-opacity ${
            status === "loaded" ? "opacity-100" : "opacity-0"
          }`}
          loading="eager"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      </div>

      <div
        className={`mt-2 rounded-lg px-2 py-1 text-center text-xs font-medium ${
          selected
            ? "bg-black text-white"
            : canSelect
              ? "bg-gray-100 text-gray-800"
              : "bg-gray-50 text-gray-400"
        }`}
      >
        {selected
          ? "Выбрано ✓"
          : status === "loaded"
            ? "Выбрать фото"
            : status === "error"
              ? "Недоступно"
              : "Загрузка…"}
      </div>
    </label>
  );
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const object = data as { message?: unknown; error?: unknown };
    throw new Error(String(object.message || object.error || response.status));
  }
  return data;
}

export default function AdminEnrichmentClient() {
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierGroup[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sourceUrls, setSourceUrls] = useState<Record<string, string>>({});
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});
  const [stockValues, setStockValues] = useState<Record<string, string>>({});
  const [variantStockValues, setVariantStockValues] = useState<Record<string, Record<string, string>>>({});
  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySourceForm);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const pendingCount = proposals.length;
  const sourceCount = useMemo(
    () => suppliers.reduce((sum, supplier) => sum + supplier.sources.length, 0),
    [suppliers],
  );

  async function loadProducts() {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (status !== "ALL") params.set("status", status);
    const response = await fetch(`/api/admin/enrichment/products?${params.toString()}`, {
      cache: "no-store",
    });
    setProducts((await readResponse(response)) as Product[]);
  }

  async function loadProposals() {
    const response = await fetch("/api/admin/enrichment/proposals?status=PENDING", {
      cache: "no-store",
    });
    const rows = (await readResponse(response)) as Proposal[];
    setProposals(rows);
    setStockValues((current) => {
      const next: Record<string, string> = {};
      for (const proposal of rows) {
        next[proposal.id] = current[proposal.id] ?? String(proposal.product.stock);
      }
      return next;
    });
    setVariantStockValues((current) => {
      const next: Record<string, Record<string, string>> = {};
      for (const proposal of rows) {
        const variants = proposalVariants(proposal.product.variants);
        if (!variants.length) continue;
        const previous = current[proposal.id] || {};
        next[proposal.id] = Object.fromEntries(
          variants.map((variant) => [variant.id, previous[variant.id] ?? String(variant.stock)]),
        );
      }
      return next;
    });
    setSelectedImages((current) => {
      const activeProposalIds = new Set(rows.map((proposal) => proposal.id));
      return Object.fromEntries(
        Object.entries(current).filter(([proposalId]) => activeProposalIds.has(proposalId)),
      );
    });
  }

  async function loadSources() {
    const response = await fetch("/api/admin/enrichment/sources", { cache: "no-store" });
    const rows = (await readResponse(response)) as SupplierGroup[];
    setSuppliers(rows);
    setSourceForm((current) => ({
      ...current,
      supplierId: current.supplierId || rows[0]?.id || "",
    }));
  }

  async function loadAll() {
    setLoading(true);
    setMessage(null);
    try {
      await Promise.all([loadProducts(), loadProposals(), loadSources()]);
    } catch (error) {
      setMessage(`Ошибка загрузки: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // Начальная загрузка выполняется один раз; фильтры применяются отдельной кнопкой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runDiscovery(productId: string) {
    setBusyKey(`discover:${productId}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/enrichment/products/${productId}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: sourceUrls[productId]?.trim() || "",
          discoverIfMissing: true,
        }),
      });
      await readResponse(response);
      setMessage("Предложение создано и отправлено на проверку.");
      setTab("proposals");
      await Promise.all([loadProducts(), loadProposals()]);
    } catch (error) {
      setMessage(`Поиск не выполнен: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function applyProposal(proposalId: string, mode: ApplyMode) {
    const proposal = proposals.find((item) => item.id === proposalId);
    const variants = proposalVariants(proposal?.product.variants);
    let stock: number | undefined;
    let variantStocks: Record<string, number> | undefined;

    if (variants.length) {
      variantStocks = {};
      for (const variant of variants) {
        const value = Number(variantStockValues[proposalId]?.[variant.id] ?? variant.stock);
        if (!Number.isInteger(value) || value < 0) {
          setMessage(`Количество для варианта «${variant.label}» должно быть целым числом от 0 и выше.`);
          return;
        }
        variantStocks[variant.id] = value;
      }
    } else {
      stock = Number(stockValues[proposalId] ?? "0");
      if (!Number.isInteger(stock) || stock < 0) {
        setMessage("Количество должно быть целым числом от 0 и выше.");
        return;
      }
    }

    setBusyKey(`apply:${proposalId}:${mode}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/enrichment/proposals/${proposalId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          imageUrl: selectedImages[proposalId] || "",
          stock,
          variantStocks,
        }),
      });
      await readResponse(response);
      setMessage(
        mode === "ALL"
          ? "Описание, фото и количество применены. Товар добавлен в черновики для публикации."
          : mode === "DESCRIPTION"
            ? "Описание и количество сохранены. Предложение остаётся на проверке."
            : "Фото и количество сохранены. Предложение остаётся на проверке.",
      );
      await Promise.all([loadProducts(), loadProposals()]);
    } catch (error) {
      setMessage(`Не удалось применить предложение: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function rejectProposal(proposalId: string) {
    if (!confirm("Отклонить это предложение?")) return;
    setBusyKey(`reject:${proposalId}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/enrichment/proposals/${proposalId}/reject`, {
        method: "POST",
      });
      await readResponse(response);
      setMessage("Предложение отклонено.");
      await Promise.all([loadProducts(), loadProposals()]);
    } catch (error) {
      setMessage(`Не удалось отклонить предложение: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleSource(source: SupplierSource) {
    setBusyKey(`source:${source.id}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/enrichment/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !source.isEnabled }),
      });
      await readResponse(response);
      await loadSources();
    } catch (error) {
      setMessage(`Источник не обновлён: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function createSource(event: FormEvent) {
    event.preventDefault();
    setBusyKey("source:create");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/enrichment/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: sourceForm.supplierId,
          name: sourceForm.name.trim(),
          domain: sourceForm.domain.trim(),
          baseUrl: sourceForm.baseUrl.trim(),
          sourceType: "OFFICIAL_SITE",
          allowSubdomains: sourceForm.allowSubdomains,
          priority: Math.trunc(Number(sourceForm.priority) || 0),
          selectors: null,
        }),
      });
      await readResponse(response);
      setMessage("Разрешённый источник добавлен.");
      setSourceForm((current) => ({ ...emptySourceForm, supplierId: current.supplierId }));
      await loadSources();
    } catch (error) {
      setMessage(`Источник не добавлен: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Автозаполнение товаров</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Поиск выполняется только по разрешённым источникам. Найденные данные сначала попадают
            в предложения и не публикуются без проверки администратора.
          </p>
        </div>
        <button
          type="button"
          className="self-start rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
          onClick={() => void loadAll()}
          disabled={loading || Boolean(busyKey)}
        >
          {loading ? "Загрузка…" : "Обновить данные"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-3">
        <TabButton active={tab === "products"} onClick={() => setTab("products")}>
          Товары ({products.length})
        </TabButton>
        <TabButton active={tab === "proposals"} onClick={() => setTab("proposals")}>
          Предложения ({pendingCount})
        </TabButton>
        <TabButton active={tab === "sources"} onClick={() => setTab("sources")}>
          Источники ({sourceCount})
        </TabButton>
      </div>

      {message && <div className="rounded-xl border bg-white px-4 py-3 text-sm">{message}</div>}

      {tab === "products" && (
        <section className="space-y-4">
          <form
            className="grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-[1fr_220px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void loadProducts();
            }}
          >
            <input
              className="rounded-xl border px-3 py-2"
              placeholder="Название, SKU, бренд или поставщик"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              className="rounded-xl border bg-white px-3 py-2"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="ALL">Все статусы</option>
              <option value="READY">Готово</option>
              <option value="REVIEW">На проверке</option>
              <option value="SEARCHING">В поиске</option>
              <option value="SOURCE_REQUIRED">Нужен источник</option>
              <option value="FAILED">Ошибка</option>
            </select>
            <button className="rounded-xl bg-black px-4 py-2 text-white" type="submit">
              Найти
            </button>
          </form>

          <div className="grid gap-3">
            {products.map((product) => {
              const lastJob = product.enrichmentJobs[0];
              const lastSource = product.sources[0];
              const hasProposal = product.enrichmentProposals.length > 0;
              const busy = busyKey === `discover:${product.id}`;
              const sourceRequired =
                product.enrichmentStatus === "SOURCE_REQUIRED" ||
                isSourceRequiredError(lastJob?.error);
              const displayStatus = sourceRequired ? "SOURCE_REQUIRED" : product.enrichmentStatus;

              return (
                <article key={product.id} className="rounded-2xl border bg-white p-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex min-w-0 gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={product.image}
                        alt=""
                        className="h-20 w-20 shrink-0 rounded-xl border object-cover"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold">{product.name}</h2>
                          <StatusBadge value={displayStatus} />
                          {!product.isPublished && <StatusBadge value="Черновик" />}
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          {product.brand?.name || "Без бренда"} · {product.supplier?.name || "Без поставщика"}
                          {product.supplierSku ? ` · SKU ${product.supplierSku}` : ""}
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-gray-500">
                          <div>
                            Последний источник: {lastSource ? lastSource.title || lastSource.url : "не найден"}
                          </div>
                          <div>
                            Последняя проверка: {formatDate(lastSource?.lastCheckedAt)}
                          </div>
                          <div>
                            Задание: {lastJob ? `${lastJob.status} · ${formatDate(lastJob.createdAt)}` : "не запускалось"}
                          </div>
                          {lastJob?.error && (
                            <div className={sourceRequired ? "text-amber-700" : "text-red-700"}>
                              {sourceRequired ? "Источник: " : "Ошибка: "}
                              {enrichmentErrorText(lastJob.error)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="w-full space-y-2 xl:max-w-xl">
                      <input
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        placeholder="Точный URL из разрешённого источника, необязательно"
                        value={sourceUrls[product.id] || ""}
                        onChange={(event) =>
                          setSourceUrls((current) => ({
                            ...current,
                            [product.id]: event.target.value,
                          }))
                        }
                      />
                      {sourceRequired && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Автопоиск по официальным страницам исчерпан. Укажите точный URL из разрешённого источника или добавьте источник во вкладке «Источники».
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                          disabled={busy || hasProposal || Boolean(busyKey && !busy)}
                          onClick={() => void runDiscovery(product.id)}
                        >
                          {busy ? "Поиск…" : hasProposal ? "Есть предложение" : "Найти данные"}
                        </button>
                        {sourceRequired && (
                          <button
                            type="button"
                            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                            onClick={() => setTab("sources")}
                          >
                            Источники
                          </button>
                        )}
                        {lastSource?.url && (
                          <a
                            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                            href={lastSource.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Открыть источник
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}

            {!loading && products.length === 0 && (
              <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500">
                Товары с поставщиком не найдены.
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "proposals" && (
        <section className="space-y-4">
          {proposals.map((proposal) => {
            const images = stringArray(proposal.images);
            const selectedImage = selectedImages[proposal.id] || "";
            const isBusy = Boolean(busyKey?.includes(proposal.id));
            const variants = proposalVariants(proposal.product.variants);

            return (
              <article key={proposal.id} className="space-y-4 rounded-2xl border bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{proposal.product.name}</h2>
                      <StatusBadge value={`${proposal.confidence}% совпадения`} />
                      {!proposal.product.isPublished && <StatusBadge value="Черновик" />}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {proposal.product.brand?.name || "Без бренда"}
                      {proposal.product.supplierSku ? ` · SKU ${proposal.product.supplierSku}` : ""}
                    </div>
                    <a
                      href={proposal.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block break-all text-sm text-blue-700 hover:underline"
                    >
                      {proposal.sourceUrl}
                    </a>
                  </div>
                  <div className="text-xs text-gray-500">
                    Создано: {formatDate(proposal.createdAt)}
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-3">
                    <TextBlock label="Заголовок" value={proposal.title} />
                    <TextBlock label="Краткое описание" value={proposal.shortDescription} />
                    <TextBlock label="Описание" value={proposal.description} />
                    <TextBlock label="Способ применения" value={proposal.application} />
                    <TextBlock label="Состав и активные компоненты" value={proposal.ingredients} />
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="mb-2 text-sm font-medium">Изображения источника</div>
                      {images.length ? (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {images.map((image, index) => (
                            <SelectableImage
                              key={image}
                              src={image}
                              index={index}
                              proposalId={proposal.id}
                              selected={selectedImage === image}
                              onSelect={() =>
                                setSelectedImages((current) => ({
                                  ...current,
                                  [proposal.id]: image,
                                }))
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500">Изображения не найдены.</div>
                      )}
                      {images.length > 0 && (
                        <div className="mt-2 text-xs text-gray-600">
                          {selectedImage
                            ? "Выбранное фото будет скопировано в Cloudinary."
                            : "Нажмите «Выбрать фото» под подходящим изображением."}
                        </div>
                      )}
                    </div>

                    {variants.length ? (
                      <div className="rounded-xl border p-3 text-sm">
                        <div className="mb-2 font-medium">Количество по вариантам</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {variants.map((variant) => (
                            <label key={variant.id} className="rounded-lg bg-gray-50 p-2">
                              <span className="mb-1 block text-xs font-medium">
                                {variant.label}
                                {variant.sku ? ` · SKU ${variant.sku}` : ""}
                              </span>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                className="w-full rounded-lg border bg-white px-3 py-2"
                                value={variantStockValues[proposal.id]?.[variant.id] ?? String(variant.stock)}
                                onChange={(event) =>
                                  setVariantStockValues((current) => ({
                                    ...current,
                                    [proposal.id]: {
                                      ...(current[proposal.id] || {}),
                                      [variant.id]: event.target.value,
                                    },
                                  }))
                                }
                              />
                              <span className="mt-1 block text-[11px] text-gray-500">
                                {variant.price.toLocaleString("ru-RU")} ₸
                              </span>
                            </label>
                          ))}
                        </div>
                        <span className="mt-2 block text-xs text-gray-500">
                          Остаток хранится отдельно для каждой фасовки.
                        </span>
                      </div>
                    ) : (
                      <label className="block rounded-xl border p-3 text-sm">
                        <span className="mb-1 block font-medium">Количество на складе</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          className="w-full rounded-xl border px-3 py-2"
                          value={stockValues[proposal.id] ?? String(proposal.product.stock)}
                          onChange={(event) =>
                            setStockValues((current) => ({
                              ...current,
                              [proposal.id]: event.target.value,
                            }))
                          }
                        />
                        <span className="mt-1 block text-xs text-gray-500">
                          Значение сохранится вместе с одобрением предложения. Ноль означает «нет в наличии».
                        </span>
                      </label>
                    )}

                    <JsonBlock label="Извлечённые факты" value={proposal.facts} />
                    <JsonBlock label="Предупреждения" value={proposal.warnings} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <button
                    type="button"
                    className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isBusy || !selectedImage}
                    title={!selectedImage ? "Сначала выберите доступное фото" : undefined}
                    onClick={() => void applyProposal(proposal.id, "ALL")}
                  >
                    Применить всё
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                    disabled={isBusy}
                    onClick={() => void applyProposal(proposal.id, "DESCRIPTION")}
                  >
                    Только описание
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                    disabled={isBusy || !selectedImage}
                    title={!selectedImage ? "Сначала выберите доступное фото" : undefined}
                    onClick={() => void applyProposal(proposal.id, "IMAGE")}
                  >
                    Только фото
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-red-200 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                    disabled={isBusy}
                    onClick={() => void rejectProposal(proposal.id)}
                  >
                    Отклонить
                  </button>
                </div>
              </article>
            );
          })}

          {!loading && proposals.length === 0 && (
            <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500">
              Нет предложений, ожидающих проверки.
            </div>
          )}
        </section>
      )}

      {tab === "sources" && (
        <section className="space-y-5">
          <form
            className="grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-2 xl:grid-cols-3"
            onSubmit={(event) => void createSource(event)}
          >
            <div className="md:col-span-2 xl:col-span-3">
              <h2 className="font-semibold">Добавить разрешённый источник</h2>
              <p className="mt-1 text-xs text-gray-500">
                Поиск и загрузка данных разрешены только с включённых доменов.
              </p>
            </div>
            <select
              required
              className="rounded-xl border bg-white px-3 py-2"
              value={sourceForm.supplierId}
              onChange={(event) =>
                setSourceForm((current) => ({ ...current, supplierId: event.target.value }))
              }
            >
              <option value="">Выберите поставщика</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            <input
              required
              className="rounded-xl border px-3 py-2"
              placeholder="Название источника"
              value={sourceForm.name}
              onChange={(event) =>
                setSourceForm((current) => ({ ...current, name: event.target.value }))
              }
            />
            <input
              required
              className="rounded-xl border px-3 py-2"
              placeholder="Домен, например angiopharm.ru"
              value={sourceForm.domain}
              onChange={(event) =>
                setSourceForm((current) => ({ ...current, domain: event.target.value }))
              }
            />
            <input
              required
              type="url"
              className="rounded-xl border px-3 py-2 md:col-span-2"
              placeholder="https://angiopharm.ru"
              value={sourceForm.baseUrl}
              onChange={(event) =>
                setSourceForm((current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
            <input
              type="number"
              min={-100}
              max={100}
              className="rounded-xl border px-3 py-2"
              placeholder="Приоритет"
              value={sourceForm.priority}
              onChange={(event) =>
                setSourceForm((current) => ({ ...current, priority: event.target.value }))
              }
            />
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sourceForm.allowSubdomains}
                onChange={(event) =>
                  setSourceForm((current) => ({
                    ...current,
                    allowSubdomains: event.target.checked,
                  }))
                }
              />
              Разрешить поддомены
            </label>
            <div className="md:col-span-2 xl:col-span-3">
              <button
                type="submit"
                className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={busyKey === "source:create"}
              >
                {busyKey === "source:create" ? "Добавление…" : "Добавить источник"}
              </button>
            </div>
          </form>

          {suppliers.map((supplier) => (
            <div key={supplier.id} className="space-y-3 rounded-2xl border bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{supplier.name}</h2>
                  <div className="text-xs text-gray-500">{supplier.slug}</div>
                </div>
                <span className="text-sm text-gray-500">Источников: {supplier.sources.length}</span>
              </div>

              <div className="grid gap-3">
                {supplier.sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex flex-col gap-3 rounded-xl border p-3 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{source.name}</span>
                        <StatusBadge value={source.isEnabled ? "ACTIVE" : "DISABLED"} />
                        <span className="text-xs text-gray-500">приоритет {source.priority}</span>
                      </div>
                      <a
                        href={source.baseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block break-all text-sm text-blue-700 hover:underline"
                      >
                        {source.baseUrl}
                      </a>
                      <div className="mt-1 text-xs text-gray-500">
                        Домен: {source.domain} · поддомены: {source.allowSubdomains ? "разрешены" : "запрещены"}
                        {` · связанных страниц: ${source._count.productSources}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="self-start rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 lg:self-auto"
                      disabled={busyKey === `source:${source.id}`}
                      onClick={() => void toggleSource(source)}
                    >
                      {source.isEnabled ? "Отключить" : "Включить"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm ${
        active ? "bg-black text-white" : "border bg-white hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

function TextBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="whitespace-pre-line text-sm text-gray-800">{value?.trim() || "—"}</div>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-600">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
