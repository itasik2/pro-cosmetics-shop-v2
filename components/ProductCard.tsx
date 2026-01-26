"use client";

import Link from "next/link";
import { useState } from "react";
import FavoriteButton from "./FavoriteCompareButtons";
import AddToCartButton from "./AddToCartButton";

type ProductCardProps = {
  product: {
    id: string;
    name: string;
    image: string;
    price: number;
    stock: number;
    isPopular: boolean;
    createdAt: Date | string;
    category: string;
    brand?: { name: string } | null;
    variants?: any;
  };
};

function isNew(createdAt: Date | string, days = 14) {
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const diff = Date.now() - d.getTime();
  return diff <= days * 24 * 60 * 60 * 1000;
}

export default function ProductCard({ product }: ProductCardProps) {
  const newBadge = isNew(product.createdAt, 14);

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const hasVariants = variants.length > 0;

  const defaultVariant = hasVariants
    ? variants.find((v: any) => (v?.stock ?? 0) > 0) ?? variants[0]
    : null;

  const [variantId, setVariantId] = useState<string | null>(
    defaultVariant?.id ?? null
  );

  const selectedVariant = hasVariants
    ? variants.find((v: any) => v?.id === variantId) ?? defaultVariant
    : null;

  const priceToShow = Number(selectedVariant?.price ?? product.price) || 0;
  const stockToUse = Math.trunc(
    Number(selectedVariant?.stock ?? product.stock) || 0
  );
  const inStock = stockToUse > 0;

  return (
    <div
      className="
        group card relative
        transition-shadow
        duration-150
        ease-out
        hover:shadow-lg
        focus-within:shadow-lg
      "
    >
      {/* Бейджи */}
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-2">
        {product.isPopular && (
          <span className="inline-flex items-center rounded-full bg-black px-2 py-1 text-xs text-white">
            Хит
          </span>
        )}
        {newBadge && (
          <span className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-1 text-xs text-white">
            Новинка
          </span>
        )}
        {!inStock && (
          <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-1 text-xs text-gray-700">
            Нет в наличии
          </span>
        )}
      </div>

      {/* Избранное */}
      <div className="absolute right-3 top-3 z-10">
        <FavoriteButton productId={product.id} />
      </div>

      {/* Изображение */}
      <Link href={`/shop/${product.id}`} className="block">
        <div className="aspect-square w-full bg-gray-100 rounded-xl mb-3 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="
              w-full h-full object-cover
              transition
              duration-150
              group-hover:brightness-105
            "
          />
        </div>
      </Link>

      {/* Бренд / категория */}
      <div className="text-sm text-gray-500">
        {product.brand?.name ?? product.category}
      </div>

      {/* Название */}
      <h3 className="font-semibold line-clamp-2">
        <Link href={`/shop/${product.id}`} className="hover:underline">
          {product.name}
        </Link>
      </h3>

      {/* Варианты */}
      {hasVariants && (
        <div className="mt-2 flex flex-wrap gap-2">
          {variants.map((v: any) => {
            const active = v?.id === variantId;
            const disabled = (v?.stock ?? 0) <= 0;

            return (
              <button
                key={String(v?.id)}
                type="button"
                disabled={disabled}
                onClick={() => setVariantId(String(v?.id))}
                className={
                  "px-3 py-1 rounded-full text-xs border transition " +
                  (active
                    ? "bg-black text-white border-black"
                    : "bg-white text-gray-700 hover:bg-gray-50") +
                  (disabled ? " opacity-40 cursor-not-allowed" : "")
                }
                title={disabled ? "Нет в наличии" : ""}
              >
                {String(v?.label ?? "")}
              </button>
            );
          })}
        </div>
      )}

      {/* Цена + корзина */}
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

      {/* Остаток */}
      <div
        className={
          "mt-1 text-xs " +
          (inStock ? "text-emerald-700" : "text-gray-500")
        }
      >
        {inStock ? `В наличии: ${stockToUse}` : "Под заказ / нет"}
      </div>

      {/* Подробнее */}
      <div className="mt-2">
        <Link
          href={`/shop/${product.id}`}
          className="text-xs text-gray-600 hover:underline"
        >
          Подробнее
        </Link>
      </div>
    </div>
  );
}
