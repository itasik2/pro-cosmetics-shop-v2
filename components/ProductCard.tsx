"use client";
import { variantDisplayImage } from "../lib/enrichment/variantImages";

import Link from "next/link";
import { memo, useState } from "react";
import FavoriteButton from "./FavoriteCompareButtons";
import AddToCartButton from "./AddToCartButton";
import { brandNameToSlug } from "@/lib/brandSlug";
import { publicShortDescription } from "@/lib/productCopy";
import { publicProductCategory } from "@/lib/catalogFilters";
import { productDisplayName } from "@/lib/productNames";
import { productThumbnail } from "@/lib/productThumbnails";

type ProductCardProps = {
  priority?: boolean;
  headingLevel?: 2 | 3;
  imageSizes?: string;
  product: {
    id: string;
    slug: string;
    name: string;
    supplierSku?: string | null;
    image: string;
    shortDescription?: string | null;
    price: number;
    stock: number;
    isPopular: boolean;
    isNew?: boolean;
    createdAt: Date | string;
    category: string;
    brand?: { name: string } | null;
    variants?: unknown;
  };
};

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
  image?: string;
};

function isRecentlyCreated(createdAt: Date | string, days = 14) {
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const time = d.getTime();
  if (!Number.isFinite(time)) return false;
  const diff = Date.now() - time;
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function normalizeVariants(value: unknown): Variant[] {
  if (!Array.isArray(value)) return [];

  const variants: Variant[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const price = Number(raw.price);
    const stock = Number(raw.stock);
    if (!id || !label || !Number.isFinite(price) || !Number.isFinite(stock)) continue;
    variants.push({
      id,
      label,
      price: Math.max(0, Math.trunc(price)),
      stock: Math.max(0, Math.trunc(stock)),
      sku: typeof raw.sku === "string" ? raw.sku : undefined,
      image: typeof raw.image === "string" ? raw.image : undefined,
    });
  }
  return variants;
}

const CATALOG_IMAGE_SIZES = "(min-width: 1152px) 318px, (min-width: 768px) calc((100vw - 198px) / 3), (min-width: 640px) calc((100vw - 140px) / 2), calc(100vw - 66px)";

function ProductCard({ product, priority = false, headingLevel = 3, imageSizes = CATALOG_IMAGE_SIZES }: ProductCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const displayName = productDisplayName(product);
  const newBadge = product.isNew === true || isRecentlyCreated(product.createdAt, 14);
  const variants = normalizeVariants(product.variants);
  const hasVariants = variants.length > 0;
  const defaultVariant = hasVariants
    ? variants.find((v) => (v.stock ?? 0) > 0) ?? variants[0]
    : null;
  const [variantId, setVariantId] = useState<string | null>(defaultVariant?.id ?? null);
  const selectedVariant = hasVariants
    ? variants.find((v) => v.id === variantId) ?? defaultVariant
    : null;
  const priceToShow = Number(selectedVariant?.price ?? product.price) || 0;
  const stockToUse = Math.trunc(Number(selectedVariant?.stock ?? product.stock) || 0);
  const inStock = stockToUse > 0;
  const imageToShow = variantDisplayImage(selectedVariant, product.image);
  const productHref = product.slug ? `/shop/${encodeURIComponent(product.slug)}` : `/api/products/by-id-redirect/${encodeURIComponent(product.id)}`;
  const stockAlertHref = `/shop/${encodeURIComponent(product.slug)}#stock-alert`;
  const brandHref = product.brand
    ? `/brand/${encodeURIComponent(brandNameToSlug(product.brand.name))}`
    : null;

  return (
    <div className="card relative h-full flex flex-col transition-shadow duration-200 hover:shadow-md"
      style={priority ? undefined : { contentVisibility: "auto", containIntrinsicSize: "auto 620px" }}>
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-2">
        {product.isPopular && (
          <span className="inline-flex items-center rounded-full bg-gray-700 px-2 py-1 text-xs text-white shadow-sm">Хит</span>
        )}
        {newBadge && (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 shadow-sm">Новинка</span>
        )}
        {!inStock && (
          <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-1 text-xs text-gray-700">Нет в наличии</span>
        )}
      </div>

      <div className="absolute right-3 top-3 z-10">
        <FavoriteButton productId={product.id} />
      </div>

      <Link href={productHref} prefetch={false} className="block aspect-square w-full bg-white rounded-xl mb-3 overflow-hidden" aria-label={`Открыть товар: ${displayName}`}>
        <img src={productThumbnail(imageToShow, 640)}
          srcSet={productThumbnail(imageToShow, 320) !== imageToShow
            ? [320, 480, 640, 768, 960].map((width) => `${productThumbnail(imageToShow, width)} ${width}w`).join(", ") : undefined}
          sizes={imageSizes} fetchPriority={priority ? "high" : undefined}
          alt={displayName} width={640} height={640} className="w-full h-full object-contain" loading={priority ? "eager" : "lazy"} decoding="async" />
      </Link>

      <div className="text-sm text-gray-500">
        {product.brand && brandHref ? (
          <Link href={brandHref} prefetch={false} className="hover:underline">{product.brand.name}</Link>
        ) : publicProductCategory(product)}
      </div>

      <Heading className="font-semibold line-clamp-2 min-h-[40px]">{displayName}</Heading>
      <p className="mt-1 min-h-[40px] line-clamp-2 text-xs leading-5 text-gray-600">
        {publicShortDescription(product.shortDescription) || "Подробное описание и способ применения — в карточке товара."}
      </p>

      <div className="mt-2 min-h-[36px]">
        {hasVariants ? (
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const active = v.id === variantId;
              const unavailable = (v.stock ?? 0) <= 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVariantId(v.id)}
                  className={
                    "px-3 py-1 rounded-full text-xs border transition-colors shadow-sm " +
                    (active ? "border-gray-400 bg-gray-200 text-gray-900" : "border-gray-200 bg-gray-50 text-gray-700") +
                    (unavailable ? " opacity-60" : " hover:border-gray-400 hover:bg-gray-100")
                  }
                  title={unavailable ? "Нет в наличии — можно подписаться на поступление" : ""}
                >
                  {v.label}{unavailable ? " · нет" : ""}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="mt-auto">
        <div className="mt-2 flex min-h-8 items-center justify-between gap-2">
          <div className="min-w-0 font-semibold">{priceToShow.toLocaleString("ru-RU")} ₸</div>
          <AddToCartButton
            productId={product.id}
            variantId={selectedVariant?.id ?? null}
            disabled={stockToUse <= 0}
            maxStock={stockToUse}
          />
        </div>

        <div className={"mt-1 text-xs " + (inStock ? "text-emerald-700" : "text-gray-500")}>
          {inStock ? `В наличии: ${stockToUse}` : "Нет в наличии"}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <Link href={productHref} prefetch={false} className="text-xs text-gray-600 hover:underline">Подробнее</Link>
          {!inStock ? (
            <Link href={stockAlertHref} prefetch={false} className="text-xs font-semibold text-amber-800 hover:underline">
              Уведомить о поступлении
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default memo(ProductCard);
