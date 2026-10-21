"use client";

import { useEffect, useState } from "react";
import {
  VariantPhotoPreview,
  VariantPhotosReview,
} from "@/components/VariantPhotoPicker";
import { adminVariants } from "@/lib/adminProductVariants";
import { automaticPhotoPlan } from "@/lib/enrichment/automaticPhotos";
import { hasManufacturerSku } from "@/lib/enrichment/photoIdentity";
import { proposalPhotoSearchMessages } from "@/lib/enrichment/clientMessages";
import { isUsablePhoto } from "@/lib/enrichment/photoQuality";
import type { VariantImageSelection } from "@/lib/enrichment/variantImages";
import type { ProposalApplyInput } from "@/lib/enrichment/proposalApplyInput";
import type { Product } from "./productTypes";

type Proposal = {
  id: string;
  title: string | null;
  shortDescription: string | null;
  description: string | null;
  application: string | null;
  ingredients: string | null;
  sourceUrl: string;
  confidence: number;
  facts: Record<string, unknown> | null;
};

type MergeGroup = {
  key: string;
  automatic: boolean;
  warnings: string[];
  kind: "duplicates" | "variants";
  suggestedCanonicalId: string;
  products: {
    id: string;
    name: string;
    sku: string | null;
    stock: number;
    variants: unknown;
  }[];
};

async function responseData(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages: Record<string, string> = {
      enrichment_already_running:
        "Поиск уже выполняется. Дождитесь результата и откройте карточку повторно.",
      product_supplier_required:
        "Для поиска укажите поставщика через импорт прайса.",
    };
    throw new Error(
      data.message ||
        messages[data.error] ||
        "Не удалось выполнить действие. Повторите попытку.",
    );
  }
  return data;
}

export default function ProductAssistant({
  product,
  dirty,
  disabled,
  onBusyChange,
  onSaved,
}: {
  product: Product;
  dirty: boolean;
  disabled: boolean;
  onBusyChange: (value: boolean) => void;
  onSaved: (product: Product, mergedIds?: string[]) => void;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [groups, setGroups] = useState<MergeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [variantImages, setVariantImages] = useState<VariantImageSelection[]>(
    [],
  );
  const variants = adminVariants(product.variants);
  const searchByName = ![
    product.supplierSku,
    ...variants.map((row) => row.sku),
  ].some(hasManufacturerSku);
  const searchLabel = searchByName ? "названию" : "SKU";
  const blocked = dirty || disabled || Boolean(busy) || loading;

  function acceptProposal(value: Proposal | null) {
    setProposal(value);
    const plan = automaticPhotoPlan({ ...product, variants }, value?.facts);
    setImageUrl(plan.imageUrl);
    setVariantImages(plan.variantImages);
  }

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const results = await Promise.allSettled([
        fetch(
          "/api/admin/enrichment/proposals?productId=" +
            encodeURIComponent(product.id),
          { cache: "no-store", signal: controller.signal },
        ).then(responseData),
        fetch(
          "/api/admin/products/variant-merge?productId=" +
            encodeURIComponent(product.id),
          { cache: "no-store", signal: controller.signal },
        ).then(responseData),
      ]);
      if (controller.signal.aborted) return;
      if (results[0].status === "fulfilled")
        acceptProposal(results[0].value[0] || null);
      if (results[1].status === "fulfilled") setGroups(results[1].value);
      if (results.some((result) => result.status === "rejected"))
        setMessage(
          "Часть инструментов не загрузилась. Закройте и откройте карточку повторно.",
        );
      setLoading(false);
    }
    void load();
    return () => controller.abort();
    // The parent remounts this panel after every saved product change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  function working(value: string | null) {
    setBusy(value);
    onBusyChange(Boolean(value));
  }

  async function task(label: string, action: () => Promise<void>) {
    if (blocked) return;
    working(label);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить действие.",
      );
    } finally {
      working(null);
    }
  }

  async function find() {
    await task(`Поиск информации и фото по ${searchLabel}…`, async () => {
      const response = await fetch(
        "/api/admin/enrichment/products/" +
          encodeURIComponent(product.id) +
          "/discover",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceUrl: sourceUrl.trim(),
            discoverIfMissing: true,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok && data.error !== "enrichment_proposal_exists") {
        await responseData(
          new Response(JSON.stringify(data), { status: response.status }),
        );
      }
      const rows = await responseData(
        await fetch(
          "/api/admin/enrichment/proposals?productId=" +
            encodeURIComponent(product.id),
          { cache: "no-store" },
        ),
      );
      const found =
        rows.find((row: Proposal) => row.id === data.proposal?.id) || rows[0];
      if (!found)
        throw new Error(
          "Предложение пока не готово. Откройте карточку повторно после завершения поиска.",
        );
      acceptProposal(found);
      setMessage(
        "Данные найдены. Проверьте описание и подобранные фото, затем примените в карточку.",
      );
    });
  }

  async function photos() {
    if (!proposal) return;
    await task(`Подбор фото по ${searchLabel}…`, async () => {
      const result = await responseData(
        await fetch(
          "/api/admin/enrichment/proposals/" +
            encodeURIComponent(proposal.id) +
            "/photos",
          { method: "POST" },
        ),
      );
      acceptProposal({ ...proposal, facts: { ...proposal.facts, ...result } });
      const resultPlan = automaticPhotoPlan({ ...product, variants }, result);
      setMessage(
        resultPlan.imageUrl ||
          resultPlan.variantImages.some((row) => row.imageUrl)
          ? "Фото подобраны. Проверьте результат и примените в карточку."
          : isUsablePhoto(product.image)
            ? "Новых фото не найдено. Текущее общее фото сохранено."
            : "Подходящее фото не найдено. Повторите подбор или добавьте фото вручную; описание можно применить сейчас.",
      );
    });
  }

  async function reject() {
    if (!proposal) return;
    await task("Отклонение предложения…", async () => {
      await responseData(
        await fetch(
          "/api/admin/enrichment/proposals/" +
            encodeURIComponent(proposal.id) +
            "/reject",
          { method: "POST" },
        ),
      );
      acceptProposal(null);
      setMessage(
        "Предложение отклонено. Можно повторить поиск, указав точную ссылку.",
      );
    });
  }

  async function apply(mode: "ALL" | "IMAGE") {
    if (!proposal) return;
    await task("Применение в карточку…", async () => {
      const result = await responseData(
        await fetch(
          "/api/admin/enrichment/proposals/" +
            encodeURIComponent(proposal.id) +
            "/apply",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode,
              imageUrl,
              variantImages,
            } satisfies ProposalApplyInput),
          },
        ),
      );
      if (!result.proposal?.product)
        throw new Error(
          "Изменения сохранены. Откройте карточку повторно для обновления данных.",
        );
      onSaved({ ...product, ...result.proposal.product });
    });
  }

  async function merge(group: MergeGroup) {
    await task("Объединение карточек и вариантов…", async () => {
      const result = await responseData(
        await fetch("/api/admin/products/variant-merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canonicalId: group.suggestedCanonicalId,
            productIds: group.products.map((row) => row.id),
            automatic: true,
          }),
        }),
      );
      onSaved(result.product, result.mergedProductIds);
    });
  }

  const plan = automaticPhotoPlan({ ...product, variants }, proposal?.facts);
  const photoIssues = proposalPhotoSearchMessages(proposal?.facts);
  const hasText = Boolean(
    proposal?.shortDescription?.trim() && proposal.description?.trim(),
  );

  return (
    <section
      aria-label="ИИ и объединение товаров"
      className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4"
    >
      <div>
        <h3 className="font-semibold">ИИ и автоматизация</h3>
        <p className="mt-1 text-xs text-gray-600">
          {searchByName ? "Код прайса" : "SKU"}:{" "}
          {product.supplierSku ||
            variants
              .map((row) => row.sku)
              .filter(Boolean)
              .join(", ") ||
            "не указан"}{" "}
          · {product.supplier?.name || "Поставщик не указан"}
        </p>
      </div>
      {searchByName && (
        <p className="text-xs text-gray-600">
          Фото ищутся по названию, бренду и объёму: внутренний код прайса не
          используется как артикул производителя.
        </p>
      )}
      {dirty && (
        <p role="status" className="text-sm text-amber-800">
          Сохраните изменения карточки перед поиском или объединением.
        </p>
      )}
      {!product.supplier && (
        <p className="text-sm text-gray-600">
          Поиск информации доступен для товаров, связанных с поставщиком при
          импорте прайса.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!proposal && (
          <button
            type="button"
            disabled={blocked || !product.supplier}
            onClick={find}
            className="rounded-xl bg-gray-800 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            Найти описание и фото по {searchLabel}
          </button>
        )}
        {proposal && (
          <button
            type="button"
            disabled={blocked}
            onClick={photos}
            className="rounded-xl border bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            Подобрать фото по {searchLabel}
          </button>
        )}
      </div>
      {!proposal && product.supplier && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-600">
            Указать точную ссылку на товар
          </summary>
          <label className="mt-2 block text-xs">
            Ссылка на карточку поставщика
            <input
              type="url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              disabled={blocked}
              placeholder="https://…"
              className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
            />
          </label>
        </details>
      )}
      {loading && (
        <p role="status" className="text-sm text-gray-500">
          Загрузка инструментов…
        </p>
      )}
      {(busy || message) && (
        <p role="status" aria-live="polite" className="text-sm text-gray-700">
          {busy || message}
        </p>
      )}
      {proposal && (
        <div className="space-y-3 rounded-xl border bg-white p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>Совпадение: {proposal.confidence}%</span>
            {/^https?:\/\//i.test(proposal.sourceUrl) && (
              <a
                href={proposal.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Источник информации
              </a>
            )}
          </div>
          <p className="font-medium">{proposal.title || product.name}</p>
          <p className="whitespace-pre-wrap text-sm">
            {proposal.shortDescription || "Краткое описание не найдено"}
          </p>
          <details>
            <summary className="cursor-pointer text-xs underline">
              Проверить полное описание
            </summary>
            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto whitespace-pre-wrap text-sm">
              {[
                proposal.description,
                proposal.application && "Применение: " + proposal.application,
                proposal.ingredients && "Состав: " + proposal.ingredients,
              ]
                .filter(Boolean)
                .map((text, index) => (
                  <p key={index}>{text}</p>
                ))}
            </div>
          </details>
          <div className="flex items-center gap-3">
            <VariantPhotoPreview
              src={imageUrl || product.image}
              alt={product.name}
              className="h-20 w-20 rounded-xl border object-contain"
            />
            <p className="text-xs text-gray-600">
              {imageUrl
                ? "Подобрано новое общее фото."
                : isUsablePhoto(product.image)
                  ? "Текущее общее фото сохранено."
                  : "Общее фото пока не найдено."}
              {variants.length > 0 &&
                ` Новых фото вариантов: ${variantImages.filter((row) => row.imageUrl).length}.`}
            </p>
          </div>
          {!plan.commonCandidates.length &&
            !plan.variantImages.some((row) => row.imageUrl) &&
            photoIssues.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800">
                {photoIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          {plan.commonCandidates.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs underline">
                Выбрать общее фото
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={blocked}
                  aria-pressed={imageUrl === null}
                  onClick={() => setImageUrl(null)}
                  className="rounded-xl border px-3 py-2 text-xs"
                >
                  Сохранить текущее
                </button>
                {plan.commonCandidates.map((candidate) => (
                  <button
                    key={candidate.url}
                    type="button"
                    disabled={blocked}
                    aria-pressed={imageUrl === candidate.url}
                    onClick={() => setImageUrl(candidate.url)}
                    className={
                      "rounded-xl border p-1 " +
                      (imageUrl === candidate.url ? "ring-2 ring-blue-500" : "")
                    }
                  >
                    <VariantPhotoPreview
                      src={candidate.url}
                      alt={
                        candidate.source === "PRICE_LIST"
                          ? "Фото из прайса"
                          : "Фото с сайта"
                      }
                      className="h-16 w-16 object-contain"
                    />
                  </button>
                ))}
              </div>
            </details>
          )}
          {variants.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs underline">
                Проверить фото вариантов · {variants.length}
              </summary>
              <div className="mt-3">
                <VariantPhotosReview
                  product={{ ...product, variants }}
                  proposalId={proposal.id}
                  facts={proposal.facts}
                  value={variantImages}
                  onChange={setVariantImages}
                  commonImage={imageUrl || product.image}
                  disabled={blocked}
                  onBusyChange={(value) =>
                    working(value ? "Поиск фото…" : null)
                  }
                />
              </div>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={blocked || !hasText}
              onClick={() => apply("ALL")}
              className="rounded-xl bg-gray-800 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              Применить в карточку
            </button>
            <button
              type="button"
              disabled={blocked || (!imageUrl && !variantImages.length)}
              onClick={() => apply("IMAGE")}
              className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40"
            >
              Применить только фото
            </button>
            <button
              type="button"
              disabled={blocked}
              onClick={reject}
              className="rounded-xl border px-3 py-2 text-sm text-red-700 disabled:opacity-40"
            >
              Отклонить
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Цены и остатки сохраняются. Текст можно отредактировать ниже после
            применения.
          </p>
        </div>
      )}
      <div className="border-t pt-3">
        <h4 className="text-sm font-medium">Дубли и варианты</h4>
        {!loading && !groups.length && (
          <p className="mt-1 text-xs text-gray-500">
            Совпадений по бренду и названию не найдено.
          </p>
        )}
        {groups.map((group) => (
          <div
            key={group.key}
            className="mt-2 space-y-2 rounded-xl border bg-white p-3"
          >
            <p className="text-sm">
              {group.kind === "duplicates"
                ? "Найдены дубли"
                : "Найдены карточки одного товара"}{" "}
              · {group.products.length}
            </p>
            <ul className="space-y-1 text-xs text-gray-600">
              {group.products.map((row) => (
                <li key={row.id}>
                  {row.name} · SKU {row.sku || "—"} ·{" "}
                  {adminVariants(row.variants).length
                    ? adminVariants(row.variants).reduce(
                        (sum, variant) => sum + variant.stock,
                        0,
                      )
                    : row.stock}{" "}
                  шт.
                  {row.id === group.suggestedCanonicalId ? " · основная" : ""}
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-500">
              Одинаковый SKU: сохраняется больший остаток. Остатки разных SKU
              суммируются. Фото вариантов и заказы сохраняются; дубли
              архивируются.
            </p>
            {group.warnings.map((warning) => (
              <p key={warning} className="text-xs text-amber-800">
                {warning}
              </p>
            ))}
            <button
              type="button"
              disabled={blocked || !group.automatic}
              onClick={() => merge(group)}
              className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40"
            >
              Объединить автоматически
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
