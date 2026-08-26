"use client";

import { useEffect, useMemo, useState } from "react";

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
};

type Proposal = {
  id: string;
  confidence: number;
  images: unknown;
  facts: unknown;
  product: {
    id: string;
    name: string;
    image: string;
    stock: number;
    variants: unknown;
    brand: { name: string } | null;
  };
};

type ImageInfo = {
  width: number;
  height: number;
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function variantsFrom(value: unknown): Variant[] {
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

function imageSource(url: string) {
  return url.includes("/price-imports/") ? "Фото из прайса" : "Фото из сети";
}

function imageQuality(info: ImageInfo | undefined) {
  if (!info) return { label: "Размер определяется…", className: "bg-gray-100 text-gray-600" };
  const minSide = Math.min(info.width, info.height);
  if (minSide >= 800) {
    return { label: "Хорошее качество", className: "bg-emerald-100 text-emerald-800" };
  }
  if (minSide >= 500) {
    return { label: "Среднее качество", className: "bg-amber-100 text-amber-800" };
  }
  return { label: "Низкое разрешение", className: "bg-red-100 text-red-800" };
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const object = data as { message?: unknown; error?: unknown };
    throw new Error(String(object.message || object.error || response.status));
  }
  return data;
}

export default function UniversalProposalReview() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});
  const [imageInfo, setImageInfo] = useState<Record<string, ImageInfo>>({});
  const [stocks, setStocks] = useState<Record<string, string>>({});
  const [variantStocks, setVariantStocks] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/enrichment/proposals?status=PENDING", {
        cache: "no-store",
      });
      const rows = (await readResponse(response)) as Proposal[];
      setProposals(rows);
      setStocks((current) =>
        Object.fromEntries(
          rows.map((proposal) => [
            proposal.id,
            current[proposal.id] ?? String(proposal.product.stock),
          ]),
        ),
      );
      setVariantStocks((current) => {
        const next: Record<string, Record<string, string>> = {};
        for (const proposal of rows) {
          const previous = current[proposal.id] || {};
          const variants = variantsFrom(proposal.product.variants);
          if (!variants.length) continue;
          next[proposal.id] = Object.fromEntries(
            variants.map((variant) => [
              variant.id,
              previous[variant.id] ?? String(variant.stock),
            ]),
          );
        }
        return next;
      });
      setSelectedImages((current) => {
        const ids = new Set(rows.map((row) => row.id));
        return Object.fromEntries(
          Object.entries(current).filter(([proposalId]) => ids.has(proposalId)),
        );
      });
    } catch (error) {
      setMessage(`Ошибка загрузки: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const total = proposals.length;
  const withPriceImages = useMemo(
    () =>
      proposals.filter((proposal) =>
        stringArray(proposal.images).some((url) => url.includes("/price-imports/")),
      ).length,
    [proposals],
  );

  function inventoryPayload(proposal: Proposal) {
    const variants = variantsFrom(proposal.product.variants);
    if (variants.length) {
      const values: Record<string, number> = {};
      for (const variant of variants) {
        const value = Number(variantStocks[proposal.id]?.[variant.id] ?? variant.stock);
        if (!Number.isInteger(value) || value < 0) {
          throw new Error(`Количество для «${variant.label}» должно быть целым числом от 0.`);
        }
        values[variant.id] = value;
      }
      return { variantStocks: values };
    }

    const value = Number(stocks[proposal.id] ?? proposal.product.stock);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("Количество должно быть целым числом от 0.");
    }
    return { stock: value };
  }

  async function apply(proposal: Proposal, mode: "ALL" | "INVENTORY") {
    setBusy(`${mode}:${proposal.id}`);
    setMessage(null);
    try {
      const inventory = inventoryPayload(proposal);
      const imageUrl = selectedImages[proposal.id] || "";
      const response = await fetch(`/api/admin/enrichment/proposals/${proposal.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          imageUrl,
          ...inventory,
        }),
      });
      await readResponse(response);
      setMessage(
        mode === "INVENTORY"
          ? "Количество сохранено. Фото и текст не изменялись."
          : imageUrl
            ? "Текст, количество и выбранное фото применены."
            : "Текст и количество применены. Текущее фото оставлено без изменений.",
      );
      await load();
    } catch (error) {
      setMessage(`Не удалось применить: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold">Универсальное применение</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-700">
            Прайс может быть без фотографий. Цена и варианты уже живут отдельно, а здесь
            можно завершить карточку с новым фото или оставить текущее изображение.
          </p>
          <div className="mt-2 text-xs text-gray-500">
            Предложений: {total} · с фото из прайса: {withPriceImages}
          </div>
        </div>
        <button
          type="button"
          className="self-start rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => void load()}
          disabled={loading || Boolean(busy)}
        >
          {loading ? "Обновление…" : "Обновить"}
        </button>
      </div>

      {message && <div className="rounded-xl border bg-white px-3 py-2 text-sm">{message}</div>}

      <div className="grid gap-3">
        {proposals.map((proposal) => {
          const images = stringArray(proposal.images);
          const selectedImage = selectedImages[proposal.id] || "";
          const variants = variantsFrom(proposal.product.variants);
          const isBusy = Boolean(busy?.endsWith(proposal.id));

          return (
            <details key={proposal.id} className="rounded-xl border bg-white p-3">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{proposal.product.name}</div>
                    <div className="text-xs text-gray-500">
                      {proposal.product.brand?.name || "Без бренда"} · {proposal.confidence}% совпадения
                    </div>
                  </div>
                  <span className="rounded-full border px-2 py-1 text-xs">
                    {selectedImage ? "Будет новое фото" : "Текущее фото сохранится"}
                  </span>
                </div>
              </summary>

              <div className="mt-4 grid gap-4 lg:grid-cols-[180px_1fr]">
                <div>
                  <div className="mb-1 text-xs font-medium text-gray-500">Текущее фото</div>
                  <div className="aspect-square overflow-hidden rounded-xl border bg-gray-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proposal.product.image}
                      alt="Текущее фото товара"
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <button
                    type="button"
                    className="mt-2 w-full rounded-lg border px-2 py-1.5 text-xs hover:bg-gray-50"
                    onClick={() =>
                      setSelectedImages((current) => ({ ...current, [proposal.id]: "" }))
                    }
                  >
                    Оставить текущее фото
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="mb-2 text-sm font-medium">Кандидаты изображений</div>
                    {images.length ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                        {images.map((url) => {
                          const info = imageInfo[url];
                          const quality = imageQuality(info);
                          const selected = selectedImage === url;
                          return (
                            <button
                              key={url}
                              type="button"
                              className={`rounded-xl border p-2 text-left ${
                                selected ? "border-black ring-2 ring-black" : "hover:border-gray-500"
                              }`}
                              onClick={() =>
                                setSelectedImages((current) => ({ ...current, [proposal.id]: url }))
                              }
                            >
                              <div className="relative aspect-square overflow-hidden rounded-lg bg-gray-50">
                                <span className="absolute left-2 top-2 z-10 rounded-full bg-black/80 px-2 py-1 text-[10px] font-semibold text-white">
                                  {imageSource(url)}
                                </span>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={url}
                                  alt="Кандидат фото"
                                  className="h-full w-full object-contain"
                                  onLoad={(event) => {
                                    const image = event.currentTarget;
                                    setImageInfo((current) => ({
                                      ...current,
                                      [url]: {
                                        width: image.naturalWidth,
                                        height: image.naturalHeight,
                                      },
                                    }));
                                  }}
                                />
                              </div>
                              <div className="mt-2 text-xs font-medium">
                                {info ? `${info.width} × ${info.height}px` : "Определение размера…"}
                              </div>
                              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] ${quality.className}`}>
                                {quality.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed p-3 text-sm text-gray-500">
                        В прайсе и найденном источнике фото нет. Это не блокирует работу:
                        текущее фото останется без изменений.
                      </div>
                    )}
                  </div>

                  {variants.length ? (
                    <div className="rounded-xl border p-3">
                      <div className="mb-2 text-sm font-medium">Количество по вариантам</div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {variants.map((variant) => (
                          <label key={variant.id} className="rounded-lg bg-gray-50 p-2 text-xs">
                            <span className="mb-1 block font-medium">
                              {variant.label}{variant.sku ? ` · ${variant.sku}` : ""}
                            </span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="w-full rounded-lg border bg-white px-3 py-2"
                              value={variantStocks[proposal.id]?.[variant.id] ?? String(variant.stock)}
                              onChange={(event) =>
                                setVariantStocks((current) => ({
                                  ...current,
                                  [proposal.id]: {
                                    ...(current[proposal.id] || {}),
                                    [variant.id]: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <label className="block rounded-xl border p-3 text-sm">
                      <span className="mb-1 block font-medium">Количество на складе</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full max-w-xs rounded-lg border px-3 py-2"
                        value={stocks[proposal.id] ?? String(proposal.product.stock)}
                        onChange={(event) =>
                          setStocks((current) => ({ ...current, [proposal.id]: event.target.value }))
                        }
                      />
                    </label>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                      disabled={isBusy}
                      onClick={() => void apply(proposal, "ALL")}
                    >
                      {busy === `ALL:${proposal.id}` ? "Применение…" : "Применить всё"}
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                      disabled={isBusy}
                      onClick={() => void apply(proposal, "INVENTORY")}
                    >
                      {busy === `INVENTORY:${proposal.id}` ? "Сохранение…" : "Сохранить только количество"}
                    </button>
                  </div>
                </div>
              </div>
            </details>
          );
        })}

        {!loading && proposals.length === 0 && (
          <div className="rounded-xl border border-dashed bg-white p-4 text-sm text-gray-500">
            Нет предложений, ожидающих проверки.
          </div>
        )}
      </div>
    </section>
  );
}
