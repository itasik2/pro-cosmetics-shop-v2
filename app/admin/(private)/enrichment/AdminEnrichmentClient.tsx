"use client";

import {
  VariantPhotoPreview,
  VariantPhotosReview,
} from "@/components/VariantPhotoPicker";
import { productDisplayName } from "@/lib/productNames";
import AutomaticProposalPhotos from "@/components/AutomaticProposalPhotos";
import { prepareProposalPhotoBatches, type PreparedProposalPhotos } from "@/lib/enrichment/preparePhotosClient";
import { ProposalTextEditor } from "@/components/ProposalTextEditor";
import {
  applyProposalChange,
  publishProposalChange,
  subscribeProposalChanges,
} from "@/lib/enrichment/proposalChanges";
import {
  automaticPhotoPlan,
  mergeAutomaticSelections,
} from "@/lib/enrichment/automaticPhotos";
import { isProductPhoto, isUsablePhoto } from "@/lib/enrichment/photoQuality";
import {
  adminVariants,
  variantStockChanges,
  type AdminVariant,
} from "@/lib/adminProductVariants";
import {
  photoSku,
  type VariantImageSelection,
} from "@/lib/enrichment/variantImages";
import { enrichmentFailureMessage } from "../../../../lib/enrichment/clientMessages";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Tab = "products" | "proposals" | "sources";
type ApplyMode =
  "ALL" | "DESCRIPTION" | "DESCRIPTION_FINAL" | "IMAGE" | "INVENTORY";

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
  textVersion: string;
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
    brandId: string | null;
    volumeValue: number | null;
    volumeUnit: string | null;
    supplierSku: string | null;
    image: string;
    shortDescription: string | null;
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
    sourceType: string;
    lastCheckedAt: string | null;
    lastChangedAt: string | null;
    status: string;
    supplierSource: {
      domain: string;
      sourceType: string;
      isEnabled: boolean;
    } | null;
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

type AutopilotOverview = {
  config: {
    enabled: boolean;
    minConfidence: number;
    proposalBatch: number;
    discoveryBatch: number;
    monitorBatch: number;
  };
  counts: {
    pendingProposals: number;
    pendingDiscovery: number;
    sourceRequired: number;
    recentAutomaticChanges: number;
  };
  recentChanges: Array<{
    id: string;
    appliedAt: string | null;
    sourceUrl: string;
    confidence: number;
    product: { id: string; name: string; image: string };
  }>;
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
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function autopilotEvaluation(value: unknown) {
  const evaluation = jsonObject(jsonObject(value).catalogAutopilotEvaluation);
  const decision =
    typeof evaluation.decision === "string" ? evaluation.decision : "";
  const reasons = stringArray(evaluation.reasons);
  return decision ? { decision, reasons } : null;
}

function autopilotReasonText(value: string) {
  const labels: Record<string, string> = {
    confidence_below_auto_apply_threshold:
      "совпадение ниже порога автоприменения",
    official_source_required: "нужен официальный источник",
    source_disabled: "источник отключён",
    source_domain_mismatch: "адрес не соответствует разрешённому домену",
    description_too_short: "полное описание слишком короткое",
    description_too_long: "полное описание слишком длинное",
    short_description_too_short: "краткое описание слишком короткое",
    short_description_too_long: "краткое описание длиннее 280 символов",
    skin_or_task_section_missing: "не указан тип кожи или задачи ухода",
    benefits_missing: "меньше трёх подтверждённых преимуществ",
    application_missing: "нет полноценного способа применения",
    manual_text_review_required:
      "текст отредактирован вручную и ожидает одобрения",
    manual_variant_review_required:
      "вариант удалён вручную; проверьте карточку перед применением",
    photo_search_pending: "автоматический подбор фото вариантов ещё продолжается",
    promotional_text_found: "обнаружены рекламные SEO-фразы",
    low_match_retry_required: "нужен повторный поиск источника",
    low_match_manual_review_required:
      "низкое совпадение после повторного поиска",
  };
  if (value.startsWith("blocking_warning:")) {
    return `критическое предупреждение источника: ${value.slice("blocking_warning:".length)}`;
  }
  return labels[value] || value;
}

const proposalVariants = adminVariants;

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
  return enrichmentFailureMessage(value);
}

function statusLabel(value: string) {
  return value.toUpperCase() === "SOURCE_REQUIRED" ? "Нужен источник" : value;
}

function statusClass(status: string) {
  const normalized = status.toUpperCase();
  if (["READY", "APPLIED", "ACTIVE"].includes(normalized)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (
    ["REVIEW", "PENDING", "RUNNING", "SOURCE_REQUIRED"].includes(normalized)
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (["FAILED", "ERROR", "BLOCKED", "UNAVAILABLE"].includes(normalized)) {
    return "border-red-200 bg-red-50 text-red-800";
  }
  return "border-gray-200 bg-gray-50 text-gray-700";
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${statusClass(value)}`}
    >
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
  disabled,
}: {
  src: string;
  selected: boolean;
  proposalId: string;
  index: number;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<ImageStatus>("loading");

  useEffect(() => {
    setStatus("loading");
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "error" : current));
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [src]);

  const canSelect = status === "loaded" && !disabled;

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
  const data = await response
    .json()
    .catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) {
    const object = data as { message?: unknown; error?: unknown };
    throw new Error(String(object.message || object.error || response.status));
  }
  return data;
}

export default function AdminEnrichmentClient() {
  const [tab, setTab] = useState<Tab>("proposals");
  const [products, setProducts] = useState<Product[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const proposalRequest = useRef(0);
  const autopilotStop = useRef(false);
  const commonPhotoOverrides = useRef(new Set<string>());
  const unchangedPhotos = useRef<Record<string, Pick<VariantImageSelection, "variantId" | "sku">[]>>({});
  const [automaticPhotosBusy, setAutomaticPhotosBusy] = useState<Record<string, boolean>>({});
  const [stopRequested, setStopRequested] = useState(false);
  const [editingText, setEditingText] = useState<Record<string, boolean>>({});
  const [actionMessages, setActionMessages] = useState<Record<string, string>>(
    {},
  );
  const [suppliers, setSuppliers] = useState<SupplierGroup[]>([]);
  const [autopilot, setAutopilot] = useState<AutopilotOverview | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sourceUrls, setSourceUrls] = useState<Record<string, string>>({});
  const [variantImages, setVariantImages] = useState<
    Record<string, VariantImageSelection[]>
  >({});
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>(
    {},
  );
  const [stockValues, setStockValues] = useState<Record<string, string>>({});
  const [variantStockValues, setVariantStockValues] = useState<
    Record<string, Record<string, string>>
  >({});
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
    const response = await fetch(
      `/api/admin/enrichment/products?${params.toString()}`,
      {
        cache: "no-store",
      },
    );
    setProducts((await readResponse(response)) as Product[]);
  }

  async function loadProposals() {
    const request = ++proposalRequest.current;
    const response = await fetch(
      "/api/admin/enrichment/proposals?status=PENDING",
      {
        cache: "no-store",
      },
    );
    const rows = (await readResponse(response)) as Proposal[];
    if (request !== proposalRequest.current) return;
    setProposals(rows);
    setStockValues((current) => {
      const next: Record<string, string> = {};
      for (const proposal of rows) {
        next[proposal.id] =
          current[proposal.id] ?? String(proposal.product.stock);
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
          variants.map((variant) => [
            variant.id,
            previous[variant.id] ?? String(variant.stock),
          ]),
        );
      }
      return next;
    });
    setSelectedImages((current) =>
      Object.fromEntries(
        rows.map((proposal) => [
          proposal.id,
          commonPhotoOverrides.current.has(proposal.id) ? (current[proposal.id] || "") :
            automaticPhotoPlan(
              {
                ...proposal.product,
                variants: proposalVariants(proposal.product.variants),
              },
              proposal.facts,
            ).imageUrl ??
            "",
        ]),
      ),
    );
    setVariantImages((current) =>
      Object.fromEntries(
        rows.map((proposal) => {
          const variants = proposalVariants(proposal.product.variants);
          const automatic = automaticPhotoPlan(
            { ...proposal.product, variants },
            proposal.facts,
          ).variantImages;
          return [
            proposal.id,
            mergeAutomaticSelections(automatic, current[proposal.id] || [], variants, unchangedPhotos.current[proposal.id]),
          ];
        }),
      ),
    );
  }

  async function loadSources() {
    const response = await fetch("/api/admin/enrichment/sources", {
      cache: "no-store",
    });
    const rows = (await readResponse(response)) as SupplierGroup[];
    setSuppliers(rows);
    setSourceForm((current) => ({
      ...current,
      supplierId: current.supplierId || rows[0]?.id || "",
    }));
  }

  async function loadAutopilot() {
    const response = await fetch("/api/admin/enrichment/autopilot", {
      cache: "no-store",
    });
    setAutopilot((await readResponse(response)) as AutopilotOverview);
  }

  async function loadAll() {
    setLoading(true);
    setMessage(null);
    try {
      await Promise.all([
        loadProducts(),
        loadProposals(),
        loadSources(),
        loadAutopilot(),
      ]);
    } catch (error) {
      setMessage(
        `Ошибка загрузки: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // Начальная загрузка выполняется один раз; фильтры применяются отдельной кнопкой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      subscribeProposalChanges((change) => {
        proposalRequest.current++;
        setProposals((current) => applyProposalChange(current, change));
        void Promise.all([loadProposals(), loadAutopilot()]).catch(() =>
          setMessage(
            "Изменение сохранено. Не удалось обновить список; обновите страницу.",
          ),
        );
        // loadProposals only uses stable state setters and the request ref.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }),
    [],
  );

  useEffect(
    () => () => {
      autopilotStop.current = true;
    },
    [],
  );

  async function runAutopilot() {
    autopilotStop.current = false;
    setStopRequested(false);
    setBusyKey("autopilot:run");
    setMessage(
      "Автозаполнение запущено. Можно оставить страницу открытой — очередь обрабатывается автоматически.",
    );
    const seen = new Set<string>();
    const totals = { applied: 0, review: 0, discovered: 0, failed: 0 };
    let limited = false;
    try {
      for (let batch = 0; batch < 20 && !autopilotStop.current; batch++) {
        const response = await fetch("/api/admin/enrichment/autopilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ excludedProposalIds: [...seen] }),
        });
        const data = (await readResponse(response)) as {
          result?: {
            proposalResults?: {
              proposalId: string;
              replacementProposalId?: string;
            }[];
            summary?: Partial<typeof totals>;
          };
          overview?: AutopilotOverview;
        };
        if (data.overview) setAutopilot(data.overview);
        const summary = data.result?.summary;
        for (const key of Object.keys(totals) as (keyof typeof totals)[])
          totals[key] += summary?.[key] || 0;
        const results = data.result?.proposalResults || [];
        for (const row of results) {
          seen.add(row.proposalId);
          if (row.replacementProposalId) seen.add(row.replacementProposalId);
        }
        setMessage(
          `Автозаполнение: применено ${totals.applied}, найдено ${totals.discovered}, на проверку ${totals.review}, ошибок ${totals.failed}.`,
        );
        await Promise.all([loadProducts(), loadProposals()]);
        if (!results.length && !summary?.discovered) break;
        if (batch === 19) limited = true;
      }
      setMessage(
        `${autopilotStop.current ? "Остановлено после текущей карточки." : limited ? "Пакет завершён. Запустите снова для оставшейся очереди." : "Автозаполнение завершено."} Применено ${totals.applied}, найдено ${totals.discovered}, на проверку ${totals.review}, ошибок ${totals.failed}.`,
      );
    } catch (error) {
      setMessage(
        `Автозаполнение прервано: ${error instanceof Error ? error.message : String(error)}. Уже сохранённые изменения сохранены.`,
      );
    } finally {
      setBusyKey(null);
      setStopRequested(false);
    }
  }

  async function rollbackAutopilotChange(proposalId: string) {
    if (
      !confirm(
        "Вернуть прежние краткое и полное описания? Откат не изменит фото, цену и остатки.",
      )
    ) {
      return;
    }

    setBusyKey(`autopilot:rollback:${proposalId}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/enrichment/autopilot/revisions/${proposalId}/rollback`,
        { method: "POST" },
      );
      await readResponse(response);
      setMessage("Описание возвращено к версии до автопилота.");
      await Promise.all([loadProducts(), loadProposals(), loadAutopilot()]);
    } catch (error) {
      setMessage(
        `Не удалось откатить описание: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function runDiscovery(productId: string) {
    setBusyKey(`discover:${productId}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/enrichment/products/${productId}/discover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceUrl: sourceUrls[productId]?.trim() || "",
            discoverIfMissing: true,
          }),
        },
      );
      await readResponse(response);
      setMessage("Предложение создано и отправлено на проверку.");
      setTab("proposals");
      await Promise.all([loadProducts(), loadProposals()]);
    } catch (error) {
      setMessage(
        `Поиск не выполнен: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function applyProposal(
    proposalId: string,
    mode: ApplyMode,
    publishNow = false,
  ) {
    setActionMessages((current) => ({ ...current, [proposalId]: "" }));
    const proposal = proposals.find((item) => item.id === proposalId);
    const variants = proposalVariants(proposal?.product.variants);
    let stock: number | undefined;
    let variantStocks: Record<string, number> | undefined;

    const appliesInventory = mode === "ALL" || mode === "INVENTORY";

    try {
      if (appliesInventory && variants.length) {
        variantStocks = Object.fromEntries(
          variantStockChanges(
            variants,
            variantStockValues[proposalId] || {},
          ).map((change) => [change.variantId, change.stock]),
        );
      } else if (
        appliesInventory &&
        proposal &&
        stockValues[proposalId] !== String(proposal.product.stock)
      ) {
        const value = stockValues[proposalId] ?? String(proposal.product.stock);
        if (!/^\d+$/.test(value) || Number(value) > 1_000_000)
          throw new Error("Укажите целое количество от 0 до 1 000 000.");
        stock = Number(value);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Проверьте остатки.";
      setMessage(message);
      setActionMessages((current) => ({ ...current, [proposalId]: message }));
      return;
    }

    setBusyKey(`apply:${proposalId}:${publishNow ? "PUBLISH" : mode}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/enrichment/proposals/${proposalId}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            imageUrl: selectedImages[proposalId] || "",
            stock,
            variantStocks,
            variantImages: variantImages[proposalId] || [],
            publishNow,
          }),
        },
      );
      await readResponse(response);
      publishProposalChange({
        id: proposalId,
        status:
          mode === "ALL" || mode === "DESCRIPTION_FINAL"
            ? "APPLIED"
            : "PENDING",
      });
      setMessage(
        publishNow
          ? "Карточка сохранена и опубликована на сайте."
          : mode === "ALL"
            ? "Карточка заполнена. Выбранные фото и изменённые остатки сохранены."
            : mode === "DESCRIPTION_FINAL"
              ? "Краткое и полное описание одобрены. Фото, цена и количество не изменялись."
              : mode === "DESCRIPTION"
                ? "Описание сохранено. Фото, цена и количество не изменялись; предложение остаётся на проверке."
                : mode === "INVENTORY"
                  ? "Остатки сохранены."
                  : "Фото сохранены. Предложение остаётся на проверке.",
      );
      if (publishNow) window.dispatchEvent(new Event("products-changed"));
      void loadProducts().catch(() => undefined);
    } catch (error) {
      const message = `Не удалось применить карточку: ${error instanceof Error ? error.message : String(error)}`;
      setMessage(message);
      setActionMessages((current) => ({ ...current, [proposalId]: message }));
    } finally {
      setBusyKey(null);
    }
  }

  function chooseCommonPhoto(proposalId: string, image: string) {
    commonPhotoOverrides.current.add(proposalId);
    setSelectedImages((current) => ({ ...current, [proposalId]: image }));
  }

  function receivePreparedPhotos(proposal: Proposal, photos: PreparedProposalPhotos, preferBestCommon = false) {
    const variants = proposalVariants(proposal.product.variants);
    const plan = automaticPhotoPlan({ ...proposal.product, variants }, photos, { preferBestCommon });
    setProposals((current) => current.map((row) => row.id === proposal.id ? {
      ...row, facts: { ...((row.facts || {}) as Record<string, unknown>), ...photos },
    } : row));
    if (preferBestCommon) commonPhotoOverrides.current.add(proposal.id);
    setSelectedImages((current) => !preferBestCommon && commonPhotoOverrides.current.has(proposal.id) ? current : ({
      ...current, [proposal.id]: plan.imageUrl || "",
    }));
    setVariantImages((current) => ({ ...current, [proposal.id]: mergeAutomaticSelections(
      plan.variantImages, current[proposal.id] || [], variants, unchangedPhotos.current[proposal.id],
    ) }));
  }

  async function preparePhotos(proposal: Proposal) {
    setBusyKey(`photos:${proposal.id}`);
    setActionMessages((current) => ({ ...current, [proposal.id]: "" }));
    try {
      commonPhotoOverrides.current.delete(proposal.id);
      const photos = await prepareProposalPhotoBatches(proposal.id, {
        resume: false, onBatch: (result) => receivePreparedPhotos(proposal, result, true),
      });
      const plan = automaticPhotoPlan(
        {
          ...proposal.product,
          variants: proposalVariants(proposal.product.variants),
        },
        photos,
        { preferBestCommon: true },
      );
      publishProposalChange({ id: proposal.id, status: "PENDING" });
      setMessage(
        plan.imageUrl || plan.variantImages.length
          ? "Фото подобраны по SKU. Нажмите «Применить карточку»."
          : "Отдельные фото не найдены. Сохранены текущие фото; варианты без своего снимка используют общее.",
      );
    } catch (error) {
      setActionMessages((current) => ({
        ...current,
        [proposal.id]:
          error instanceof Error ? error.message : "Подбор фото не завершён.",
      }));
    } finally {
      setBusyKey(null);
    }
  }

  async function removeVariant(proposal: Proposal, variant: AdminVariant) {
    setBusyKey(`remove:${proposal.id}:${variant.id}`);
    setActionMessages((current) => ({ ...current, [proposal.id]: "" }));
    try {
      const response = await fetch(
        `/api/admin/enrichment/products/${encodeURIComponent(proposal.product.id)}/variants/${encodeURIComponent(variant.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalId: proposal.id, sku: variant.sku }),
        },
      );
      await readResponse(response);
      commonPhotoOverrides.current.delete(proposal.id);
      setSelectedImages((current) => {
        const next = { ...current };
        delete next[proposal.id];
        return next;
      });
      publishProposalChange({ id: proposal.id, status: "PENDING" });
      setMessage(
        `Вариант ${variant.label} (SKU ${variant.sku}) удалён и исключён из автоматического импорта.`,
      );
      await loadProposals();
      void loadProducts().catch(() => undefined);
    } catch (error) {
      setActionMessages((current) => ({
        ...current,
        [proposal.id]:
          error instanceof Error
            ? error.message
            : "Не удалось удалить вариант.",
      }));
    } finally {
      setBusyKey(null);
    }
  }

  async function rejectProposal(proposalId: string) {
    setBusyKey(`reject:${proposalId}`);
    setMessage(null);
    setActionMessages((current) => ({ ...current, [proposalId]: "" }));
    try {
      const response = await fetch(
        `/api/admin/enrichment/proposals/${proposalId}/reject`,
        {
          method: "POST",
        },
      );
      await readResponse(response);
      publishProposalChange({ id: proposalId, status: "REJECTED" });
      setMessage("Предложение отклонено.");
      void loadProducts().catch(() => undefined);
    } catch (error) {
      const message = `Не удалось отклонить предложение: ${error instanceof Error ? error.message : String(error)}`;
      setMessage(message);
      setActionMessages((current) => ({ ...current, [proposalId]: message }));
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleSource(source: SupplierSource) {
    setBusyKey(`source:${source.id}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/enrichment/sources/${source.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isEnabled: !source.isEnabled }),
        },
      );
      await readResponse(response);
      await loadSources();
    } catch (error) {
      setMessage(
        `Источник не обновлён: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      setSourceForm((current) => ({
        ...emptySourceForm,
        supplierId: current.supplierId,
      }));
      await loadSources();
    } catch (error) {
      setMessage(
        `Источник не добавлен: ${error instanceof Error ? error.message : String(error)}`,
      );
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
            Автопилот заполняет описание и подбирает фото по точному SKU. При
            совпадении от 90% с официальным источником данные применяются
            автоматически. Спорные карточки остаются здесь.
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

      {autopilot && (
        <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Автоматическое заполнение</h2>
                <StatusBadge
                  value={autopilot.config.enabled ? "ACTIVE" : "DISABLED"}
                />
              </div>
              <p className="mt-1 max-w-3xl text-sm text-gray-700">
                Порог — {autopilot.config.minConfidence}%. Низкое совпадение
                перепроверяется один раз, сомнительные данные остаются в
                предложениях, совпадение 0% отбрасывается.
              </p>
            </div>
            <button
              type="button"
              className="self-start rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={
                Boolean(busyKey) ||
                Object.values(editingText).some(Boolean) ||
                !autopilot.config.enabled
              }
              onClick={() => void runAutopilot()}
            >
              {busyKey === "autopilot:run"
                ? "Очередь обрабатывается…"
                : "Заполнить автоматически"}
            </button>
            {busyKey === "autopilot:run" && (
              <button
                type="button"
                disabled={stopRequested}
                className="self-start rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
                onClick={() => {
                  autopilotStop.current = true;
                  setStopRequested(true);
                }}
              >
                {stopRequested
                  ? "Остановка после текущей карточки…"
                  : "Остановить"}
              </button>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Ожидают проверки"
              value={autopilot.counts.pendingProposals}
            />
            <Metric
              label="Ожидают поиска"
              value={autopilot.counts.pendingDiscovery}
            />
            <Metric
              label="Нужен источник"
              value={autopilot.counts.sourceRequired}
            />
            <Metric
              label="Недавние автоправки"
              value={autopilot.counts.recentAutomaticChanges}
            />
          </div>

          {autopilot.recentChanges.length > 0 && (
            <details className="rounded-xl border border-emerald-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Журнал последних автоприменений и откат
              </summary>
              <div className="mt-3 grid gap-2">
                {autopilot.recentChanges.map((change) => (
                  <div
                    key={change.id}
                    className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{change.product.name}</div>
                      <div className="text-xs text-gray-500">
                        {change.confidence}% · {formatDate(change.appliedAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="self-start rounded-xl border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 sm:self-auto"
                      disabled={Boolean(busyKey)}
                      onClick={() => void rollbackAutopilotChange(change.id)}
                    >
                      {busyKey === `autopilot:rollback:${change.id}`
                        ? "Откат…"
                        : "Откатить текст"}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-b pb-3">
        <TabButton
          active={tab === "products"}
          onClick={() => setTab("products")}
        >
          Товары ({products.length})
        </TabButton>
        <TabButton
          active={tab === "proposals"}
          onClick={() => setTab("proposals")}
        >
          Предложения ({pendingCount})
        </TabButton>
        <TabButton active={tab === "sources"} onClick={() => setTab("sources")}>
          Источники ({sourceCount})
        </TabButton>
      </div>

      {message && (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm">
          {message}
        </div>
      )}

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
            <button
              className="rounded-xl bg-black px-4 py-2 text-white"
              type="submit"
            >
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
              const displayStatus = sourceRequired
                ? "SOURCE_REQUIRED"
                : product.enrichmentStatus;

              return (
                <article
                  key={product.id}
                  className="rounded-2xl border bg-white p-4"
                >
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
                          <h2 className="font-semibold">{productDisplayName(product)}</h2>
                          <StatusBadge value={displayStatus} />
                          {!product.isPublished && (
                            <StatusBadge value="Черновик" />
                          )}
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          {product.brand?.name || "Без бренда"} ·{" "}
                          {product.supplier?.name || "Без поставщика"}
                          {product.supplierSku
                            ? ` · SKU ${product.supplierSku}`
                            : ""}
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-gray-500">
                          <div>
                            Последний источник:{" "}
                            {lastSource
                              ? lastSource.title || lastSource.url
                              : "не найден"}
                          </div>
                          <div>
                            Последняя проверка:{" "}
                            {formatDate(lastSource?.lastCheckedAt)}
                          </div>
                          <div>
                            Задание:{" "}
                            {lastJob
                              ? `${lastJob.status} · ${formatDate(lastJob.createdAt)}`
                              : "не запускалось"}
                          </div>
                          {lastJob?.error && (
                            <div
                              className={
                                sourceRequired
                                  ? "text-amber-700"
                                  : "text-red-700"
                              }
                            >
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
                          Автопоиск по официальным страницам исчерпан. Укажите
                          точный URL из разрешённого источника или добавьте
                          источник во вкладке «Источники».
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                          disabled={
                            busy || hasProposal || Boolean(busyKey && !busy)
                          }
                          onClick={() => void runDiscovery(product.id)}
                        >
                          {busy
                            ? "Поиск…"
                            : hasProposal
                              ? "Есть предложение"
                              : "Найти данные"}
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
            const photoPlan = automaticPhotoPlan(
              {
                ...proposal.product,
                variants: proposalVariants(proposal.product.variants),
              },
              proposal.facts,
            );
            const images = photoPlan.commonCandidates.length
              ? photoPlan.commonCandidates.map((item) => item.url)
              : proposal.confidence >= 70
                ? stringArray(proposal.images).filter(isProductPhoto)
                : [];
            const selectedImage = selectedImages[proposal.id] || "";
            const isBusy = Boolean(busyKey) || automaticPhotosBusy[proposal.id];
            const variants = proposalVariants(proposal.product.variants);
            const evaluation = autopilotEvaluation(proposal.facts);

            return (
              <article
                key={proposal.id}
                className="space-y-4 rounded-2xl border bg-white p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">
                        {productDisplayName(proposal.product)}
                      </h2>
                      <StatusBadge
                        value={`${proposal.confidence}% совпадения`}
                      />
                      <StatusBadge
                        value={
                          proposal.source?.sourceType === "OFFICIAL_SITE"
                            ? "Официальный источник"
                            : "Внешний источник"
                        }
                      />
                      {!proposal.product.isPublished && (
                        <StatusBadge value="Черновик" />
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {proposal.product.brand?.name || "Без бренда"}
                      {proposal.product.supplierSku
                        ? ` · SKU ${proposal.product.supplierSku}`
                        : ""}
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

                {proposal.product.supplier && (
                  <AutomaticProposalPhotos
                    proposalId={proposal.id}
                    product={{ ...proposal.product, variants }}
                    facts={proposal.facts}
                    disabled={Boolean(busyKey) || editingText[proposal.id]}
                    onPrepared={(photos) => receivePreparedPhotos(proposal, photos)}
                    onBusyChange={(busy) => setAutomaticPhotosBusy((current) => ({ ...current, [proposal.id]: busy }))}
                  />
                )}
                {evaluation && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <div className="font-medium">
                      Почему требуется участие человека
                    </div>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                      {evaluation.reasons.map((reason) => (
                        <li key={reason}>{autopilotReasonText(reason)}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-3">
                    <ProposalTextEditor
                      proposal={proposal}
                      disabled={isBusy}
                      onEditingChange={(editing) =>
                        setEditingText((current) => ({
                          ...current,
                          [proposal.id]: editing,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-xl border p-3">
                      <div className="flex items-center gap-3">
                        <VariantPhotoPreview
                          src={selectedImage || proposal.product.image}
                          alt={proposal.product.name}
                          className="h-20 w-20 rounded-lg bg-white object-contain"
                        />
                        <div className="text-sm">
                          <div className="font-medium">Общее фото товара</div>
                          <p className="mt-1 text-xs text-gray-600">
                            {selectedImage
                              ? "Общее фото выбрано и готово к применению."
                              : "Используется текущее общее фото."}
                          </p>
                        </div>
                      </div>
                      {images.length > 0 && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs">
                            Выбрать другое фото ({images.length})
                          </summary>
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {images.map((image, index) => (
                              <SelectableImage
                                key={image}
                                src={image}
                                index={index}
                                proposalId={proposal.id}
                                disabled={isBusy}
                                selected={selectedImage === image}
                                onSelect={() => chooseCommonPhoto(proposal.id, image)}
                              />
                            ))}
                          </div>
                          <button
                            type="button"
                            disabled={isBusy}
                            className="mt-2 rounded-lg border px-3 py-1 text-xs"
                            onClick={() => chooseCommonPhoto(proposal.id, "")}
                          >
                            Оставить текущее фото
                          </button>
                        </details>
                      )}
                    </div>
                    <VariantPhotosReview
                      product={proposal.product}
                      proposalId={proposal.id}
                      facts={proposal.facts}
                      commonImage={selectedImage}
                      onCommonImageChange={(imageUrl) => chooseCommonPhoto(proposal.id, imageUrl)}
                      stocks={variantStockValues[proposal.id]}
                      value={variantImages[proposal.id] || []}
                      disabled={isBusy || editingText[proposal.id]}
                      onStockChange={(id, value) =>
                        setVariantStockValues((current) => ({
                          ...current,
                          [proposal.id]: {
                            ...current[proposal.id],
                            [id]: value,
                          },
                        }))
                      }
                      onRemove={(variant) =>
                        void removeVariant(proposal, variant)
                      }
                      onChange={(value, unchanged) => {
                        if (unchanged) unchangedPhotos.current[proposal.id] = [...(unchangedPhotos.current[proposal.id] || []), unchanged];
                        setVariantImages((current) => ({
                          ...current,
                          [proposal.id]: value,
                        }));
                        if (!selectedImage && !isUsablePhoto(proposal.product.image)) {
                          const available = value.find((item) => item.imageUrl && isUsablePhoto(item.imageUrl))?.imageUrl;
                          if (available && !commonPhotoOverrides.current.has(proposal.id)) chooseCommonPhoto(proposal.id, available);
                        }
                      }}
                    />
                    {!variants.length && (
                      <label className="block rounded-xl border p-3 text-sm">
                        <span className="mb-1 block font-medium">
                          Количество на складе
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={1000000}
                          step={1}
                          inputMode="numeric"
                          disabled={isBusy}
                          className="w-32 rounded-lg border px-3 py-2"
                          value={
                            stockValues[proposal.id] ??
                            String(proposal.product.stock)
                          }
                          onChange={(event) =>
                            setStockValues((current) => ({
                              ...current,
                              [proposal.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    )}

                    <JsonBlock
                      label="Извлечённые факты"
                      value={proposal.facts}
                    />
                    <JsonBlock
                      label="Предупреждения"
                      value={proposal.warnings}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <button
                    type="button"
                    className={(proposal.product.isPublished ? "btn" : "btn-secondary") + " min-h-11 px-4 py-2 text-sm disabled:opacity-50"}
                    disabled={isBusy || editingText[proposal.id]}
                    onClick={() => void applyProposal(proposal.id, "ALL")}
                  >
                    {busyKey === `apply:${proposal.id}:ALL`
                      ? "Применение…"
                      : "Применить карточку"}
                  </button>
                  {!proposal.product.isPublished && (
                    <button
                      type="button"
                      className="btn min-h-11 px-4 py-2 text-sm disabled:opacity-50"
                      disabled={isBusy || editingText[proposal.id]}
                      onClick={() => void applyProposal(proposal.id, "ALL", true)}
                    >
                      {busyKey === `apply:${proposal.id}:PUBLISH`
                        ? "Публикация…"
                        : "Сохранить и опубликовать"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary min-h-11 px-4 py-2 text-sm disabled:opacity-50"
                    disabled={isBusy || editingText[proposal.id]}
                    onClick={() => void preparePhotos(proposal)}
                  >
                    {busyKey === `photos:${proposal.id}`
                      ? "Подбор фото…"
                      : "Подобрать фото автоматически"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary min-h-11 px-4 py-2 text-sm text-red-700 disabled:opacity-50"
                    disabled={isBusy || editingText[proposal.id]}
                    onClick={() => void rejectProposal(proposal.id)}
                  >
                    {busyKey === `reject:${proposal.id}`
                      ? "Отклонение…"
                      : "Отклонить"}
                  </button>
                  <details className="w-full text-xs">
                    <summary className="cursor-pointer py-2 text-gray-600">
                      Сохранить отдельно
                    </summary>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-2 disabled:opacity-50"
                        disabled={isBusy || editingText[proposal.id]}
                        onClick={() =>
                          void applyProposal(proposal.id, "DESCRIPTION_FINAL")
                        }
                      >
                        Только текст
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-2 disabled:opacity-50"
                        disabled={
                          isBusy ||
                          editingText[proposal.id] ||
                          (!selectedImage &&
                            !variantImages[proposal.id]?.length)
                        }
                        onClick={() => void applyProposal(proposal.id, "IMAGE")}
                      >
                        Только фото
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-2 disabled:opacity-50"
                        disabled={isBusy || editingText[proposal.id]}
                        onClick={() =>
                          void applyProposal(proposal.id, "INVENTORY")
                        }
                      >
                        Только остатки
                      </button>
                    </div>
                  </details>
                </div>
                {actionMessages[proposal.id] && (
                  <p role="alert" className="text-sm text-red-700">
                    {actionMessages[proposal.id]}
                  </p>
                )}
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
                setSourceForm((current) => ({
                  ...current,
                  supplierId: event.target.value,
                }))
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
                setSourceForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <input
              required
              className="rounded-xl border px-3 py-2"
              placeholder="Домен, например angiopharm.ru"
              value={sourceForm.domain}
              onChange={(event) =>
                setSourceForm((current) => ({
                  ...current,
                  domain: event.target.value,
                }))
              }
            />
            <input
              required
              type="url"
              className="rounded-xl border px-3 py-2 md:col-span-2"
              placeholder="https://angiopharm.ru"
              value={sourceForm.baseUrl}
              onChange={(event) =>
                setSourceForm((current) => ({
                  ...current,
                  baseUrl: event.target.value,
                }))
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
                setSourceForm((current) => ({
                  ...current,
                  priority: event.target.value,
                }))
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
                {busyKey === "source:create"
                  ? "Добавление…"
                  : "Добавить источник"}
              </button>
            </div>
          </form>

          {suppliers.map((supplier) => (
            <div
              key={supplier.id}
              className="space-y-3 rounded-2xl border bg-white p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{supplier.name}</h2>
                  <div className="text-xs text-gray-500">{supplier.slug}</div>
                </div>
                <span className="text-sm text-gray-500">
                  Источников: {supplier.sources.length}
                </span>
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
                        <StatusBadge
                          value={source.isEnabled ? "ACTIVE" : "DISABLED"}
                        />
                        <span className="text-xs text-gray-500">
                          приоритет {source.priority}
                        </span>
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
                        Домен: {source.domain} · поддомены:{" "}
                        {source.allowSubdomains ? "разрешены" : "запрещены"}
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-gray-600">{label}</div>
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
