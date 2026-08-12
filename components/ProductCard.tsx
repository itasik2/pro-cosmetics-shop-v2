"use client";

import Link from "next/link";
import { useState } from "react";
import FavoriteButton from "./FavoriteCompareButtons";
import AddToCartButton from "./AddToCartButton";
import { formatProductName } from "@/lib/productNames";

type ProductCardProps = {
  product: {
    id: string;
    slug: string;
    name: string;
    image: string;
    price: number;
    stock: number;
    isPopular: boolean;
    isNew?: boolean;
    createdAt: Date | string;
    category: string;
    brand?: { name: string } | null;
    variants?: any;
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

function normalizeVariants(v: any): Variant[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({
      id: String(x?.id ?? ""),
      label: String(x?.label ?? ""),
      price: Math.trunc(Number(x?.price) || 0),
      stock: Math.trunc(Number(x?.stock) || 0),
      sku: x?.sku ? String(x.sku) : undefined,
      image: x?.image ? String(x.image) : undefined,
    }))
    .filter((x) => x.id && x.label);
}

export default function ProductCard({ product }: ProductCardProps) {
  const displayName = formatProductName(product.name);
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

  const imageToShow =
    selectedVariant?.image && String(selectedVariant.image).trim().length > 0
      ? String(selectedVariant.image).trim()
      : product.image;

  return (
    <div
      className={
        "card relative h-full flex flex-col " +
        "transition-colors shadow-sm hover:shadow-md transition-all duration-200 border border-brand-soft/50"
      }
    >
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-2">
        {product.isPopular && (
          <span className="inline-flex items-center rounded-full bg-gray-700 px-2 py-1 text-xs text-white shadow-sm">
            Хит
          </span>
        )}
        {newBadge && (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 shadow-sm">
            Новинка
          </span>
        )}
        {!inStock && (
          <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-1 text-xs text-gray-700">
            Нет в наличии
          </span>
        )}
      </div>

      <div className="absolute right-3 top-3 z-10">
        <FavoriteButton productId={product.id} />
      </div>

      <Link
        href={`/api/products/by-id-redirect/${encodeURIComponent(product.id)}`}
        className="block aspect-square w-full bg-gray-100 rounded-xl mb-3 overflow-hidden"
        aria-label={`Открыть товар: ${displayName}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageToShow}
          alt={displayName}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </Link>

      <div className="text-sm text-gray-500">
        {product.brand ? (
          <Link
            href={`/brand/${product.brand.name.toLowerCase()}`}
            className="hover:underline"
          >
            {product.brand.name}
          </Link>
        ) : (
          product.category
        )}
      </div>

      <h3 className="font-semibold line-clamp-2 min-h-[40px]">
        {displayName}
      </h3>

      <div className="mt-2 min-h-[36px]">
        {hasVariants ? (
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const active = v.id === variantId;
              const disabled = (v.stock ?? 0) <= 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setVariantId(v.id)}
                  className={
                    "px-3 py-1 rounded-full text-xs border transition-colors shadow-sm " +
                    (active
                      ? "border-gray-400 bg-gray-200 text-gray-900"
                      : "border-gray-200 bg-gray-50 text-gray-700") +
                    (disabled
                      ? " opacity-40 cursor-not-allowed"
                      : " hover:border-gray-400 hover:bg-gray-100")
                  }
                  title={disabled ? "Нет в наличии" : ""}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="mt-auto">
        <div className="flex items-center justify-between mt-2 gap-2">
          <div className="font-semibold">
            {priceToShow.toLocaleString("ru-RU")} ₸
          </div>

          <AddToCartButton
            productId={product.id}
            variantId={selectedVariant?.id ?? null}
            disabled={stockToUse <= 0}
            maxStock={stockToUse}
          />
        </div>

        <div className={"mt-1 text-xs " + (inStock ? "text-emerald-700" : "text-gray-500")}>
          {inStock ? `В наличии: ${stockToUse}` : "Под заказ/нет"}
        </div>

        <div className="mt-2">
          <Link
            href={`/api/products/by-id-redirect/${encodeURIComponent(product.id)}`}
            className="text-xs text-gray-600 hover:underline"
          >
            Подробнее
          </Link>
        </div>
      </div>
    </div>
  );
}
