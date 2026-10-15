"use client";
import { useState } from "react";
import { adminVariants } from "../lib/adminProductVariants";
import {
  imageGroups,
  photoSku,
  variantDisplayImage,
  type VariantImageCandidate,
  type VariantImageSelection,
} from "../lib/enrichment/variantImages";

type Variant = { id: string; label: string; sku?: string; image?: string };

function isRealPhoto(url: string) {
  // These legacy seed files are empty, not actual product photographs.
  return (
    Boolean(url?.trim()) &&
    !/^\/seed\/(?:cleanser|cream|serum)\.jpg(?:\?|$)/.test(url)
  );
}

export function VariantPhotoPreview({
  src,
  fallback,
  alt,
  className,
}: {
  src: string;
  fallback?: string;
  alt: string;
  className: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const url = [src, fallback].find((url): url is string =>
    Boolean(url && isRealPhoto(url) && !failed.includes(url)),
  );
  if (!url)
    return (
      <div
        role="img"
        aria-label="Фото отсутствует"
        className={
          "flex items-center justify-center bg-gray-50 p-1 text-center text-[10px] text-gray-500 " +
          className
        }
      >
        Нет фото
      </div>
    );
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed((previous) => [...previous, url])}
    />
  );
}

export function VariantPhotoPicker({
  productId,
  proposalId,
  variant,
  commonImage,
  candidates = [],
  value,
  onChange,
  disabled,
}: {
  productId: string;
  proposalId?: string;
  variant: Variant;
  commonImage: string;
  candidates?: VariantImageCandidate[];
  value?: VariantImageSelection;
  onChange: (selection: VariantImageSelection | undefined) => void;
  disabled?: boolean;
}) {
  const [found, setFound] = useState<VariantImageCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const photos = found || candidates;
  const selected =
    value && photoSku(value.sku) === photoSku(variant.sku) ? value : undefined;
  const preview = selected
    ? selected.imageUrl || commonImage
    : variantDisplayImage(variant, commonImage);
  async function search() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        "/api/admin/enrichment/products/" +
          encodeURIComponent(productId) +
          "/variant-images",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variantId: variant.id,
            sku: variant.sku,
            proposalId,
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.message || result.error || "Поиск не удался");
      if (photoSku(result.sku) !== photoSku(variant.sku))
        throw new Error("SKU изменился. Повторите поиск после сохранения.");
      if (result.candidates?.length) setFound(result.candidates);
      const details = result.issues
        ?.map((issue: { message: string }) => issue.message)
        .join(" ");
      setMessage(
        result.status === "INCOMPLETE"
          ? (details || "Поиск не завершён. Повторите попытку позже.") +
              " Текущее фото и ранее найденные варианты сохранены."
          : result.candidates?.length
            ? "Найдены фото для SKU " + variant.sku + ". Выберите подходящее."
            : photos.length
              ? "Новых фото не найдено. Ранее найденные фото сохранены."
              : isRealPhoto(commonImage)
                ? "Отдельное фото не найдено. Доступно общее фото товара."
                : "Отдельное фото не найдено. Добавьте общее фото товара.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Поиск не удался");
    } finally {
      setBusy(false);
    }
  }
  function choose(imageUrl: string | null) {
    onChange({ variantId: variant.id, sku: variant.sku || "", imageUrl });
  }
  return (
    <fieldset
      disabled={disabled || busy}
      className="space-y-2 rounded-xl border p-3"
    >
      <legend className="px-1 text-sm font-medium">
        {variant.label} · SKU {variant.sku || "не указан"}
      </legend>
      <div className="flex items-center gap-3">
        <VariantPhotoPreview
          src={preview}
          fallback={commonImage}
          alt={variant.label + " · SKU " + (variant.sku || "")}
          className="h-16 w-16 rounded-lg border bg-white object-contain"
        />
        <div className="text-xs text-gray-600">
          {selected?.imageUrl
            ? "Выбрано фото варианта"
            : !isRealPhoto(preview)
              ? "Общее фото ещё не добавлено"
              : !selected && variant.image
                ? "Собственное фото варианта"
                : "Используется общее фото"}
        </div>
        <button
          type="button"
          disabled={!variant.sku}
          onClick={() => void search()}
          className="ml-auto rounded-lg border bg-white px-3 py-2 text-xs disabled:opacity-40"
        >
          {busy ? "Поиск…" : "Найти фото по SKU"}
        </button>
      </div>
      {!variant.sku && (
        <p className="text-xs text-amber-800">
          Сначала укажите и сохраните SKU варианта.
        </p>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        {proposalId && (
          <button
            type="button"
            className={
              "rounded-lg border px-2 py-1 " +
              (!selected ? "border-black bg-gray-100" : "")
            }
            onClick={() => onChange(undefined)}
          >
            Не менять
          </button>
        )}
        <button
          type="button"
          disabled={!variant.sku}
          className={
            "rounded-lg border px-2 py-1 " +
            (selected?.imageUrl === null ? "border-black bg-gray-100" : "")
          }
          onClick={() => choose(null)}
        >
          Использовать общее фото
        </button>
      </div>
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((candidate) => (
            <button
              key={candidate.url}
              type="button"
              onClick={() => choose(candidate.url)}
              aria-pressed={selected?.imageUrl === candidate.url}
              className={
                "rounded-lg border bg-white p-2 text-left " +
                (selected?.imageUrl === candidate.url
                  ? "border-black ring-1 ring-black"
                  : "")
              }
            >
              <VariantPhotoPreview
                src={candidate.url}
                alt={"Фото SKU " + variant.sku}
                className="h-24 w-full object-contain"
              />
              <span className="mt-1 block break-all text-xs">
                SKU {variant.sku} ·{" "}
                {candidate.source === "PRICE_LIST"
                  ? "Прайс, строка " + candidate.rowNumber
                  : "Сайт"}
              </span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <p className="text-xs font-medium">
          {selected.imageUrl === null
            ? "После применения будет общее фото."
            : "Выбрано отдельное фото для SKU " + variant.sku + "."}
        </p>
      )}
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </fieldset>
  );
}
export function VariantPhotosReview({
  product,
  proposalId,
  facts,
  value,
  onChange,
  disabled,
  commonImage,
}: {
  product: { id: string; image: string; variants: unknown };
  proposalId: string;
  facts: unknown;
  value: VariantImageSelection[];
  onChange: (value: VariantImageSelection[]) => void;
  disabled?: boolean;
  commonImage?: string;
}) {
  const variants = adminVariants(product.variants);
  const groups = imageGroups(
    (facts as Record<string, unknown> | null)?.variantImageCandidates,
  );
  if (!variants.length) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Фото по SKU вариантов</h3>
      <p className="text-xs text-gray-600">
        Отдельное фото применяется только к указанному SKU. При отсутствии
        своего фото вариант использует общее изображение товара.
      </p>
      {variants.map((variant) => (
        <VariantPhotoPicker
          key={variant.id + ":" + variant.sku}
          productId={product.id}
          proposalId={proposalId}
          variant={variant}
          commonImage={commonImage || product.image}
          candidates={
            groups.find(
              (group) =>
                group.variantId === variant.id &&
                photoSku(group.sku) === photoSku(variant.sku),
            )?.candidates
          }
          value={value.find((selection) => selection.variantId === variant.id)}
          disabled={disabled}
          onChange={(selection) =>
            onChange([
              ...value.filter((item) => item.variantId !== variant.id),
              ...(selection ? [selection] : []),
            ])
          }
        />
      ))}
    </section>
  );
}
