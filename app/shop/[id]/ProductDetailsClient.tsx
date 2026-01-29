"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import AddToCartButton from "@/components/AddToCartButton";
import TrackProductView from "@/components/TrackProductView";

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
  image?: string;
};

type Props = {
  product: {
    id: string;
    name: string;
    image: string;
    description: string;
    price: number;
    stock: number;
    category: string;
    brand?: { name: string } | null;
    variants?: any;
  };
};

function normalizeVariants(v: any): Variant[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => ({
      id: String(x.id),
      label: String(x.label),
      price: Number(x.price),
      stock: Number(x.stock),
      sku: x.sku,
      image: x.image,
    }))
    .filter((v) => v.id && v.label);
}

export default function ProductDetailsClient({ product }: Props) {
  const variants = useMemo(() => normalizeVariants(product.variants), [product]);
  const hasVariants = variants.length > 0;

  const defaultVariant =
    variants.find((v) => v.stock > 0) ?? variants[0] ?? null;

  const [variantId, setVariantId] = useState<string | null>(
    defaultVariant?.id ?? null
  );

  const selectedVariant = hasVariants
    ? variants.find((v) => v.id === variantId) ?? defaultVariant
    : null;

  const priceToShow = selectedVariant?.price ?? product.price;
  const stockToUse = selectedVariant?.stock ?? product.stock;
  const inStock = stockToUse > 0;

  const imageToShow = selectedVariant?.image || product.image;
  const brandName = product.brand?.name ?? "—";

  return (
  
    <div className="grid md:grid-cols-2 gap-8">
      {/* ЛЕВАЯ КОЛОНКА */}
      <div>
        {/* Фото */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageToShow}
          alt={product.name}
          className="w-full rounded-3xl border object-cover max-h-[480px]"
        />

        {/* ВАРИАНТЫ */}
        {hasVariants && (
          <div className="mt-3 flex flex-wrap gap-2">
            {variants.map((v) => {
              const active = v.id === variantId;
              const disabled = v.stock <= 0;

              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setVariantId(v.id)}
                  className={
                    "px-3 py-1 rounded-full text-xs border transition " +
                    (active ? "bg-black text-white" : "bg-white") +
                    (disabled
                      ? " opacity-40 cursor-not-allowed"
                      : " hover:bg-gray-50")
                  }
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        )}

        {/* ЦЕНА + КУПИТЬ */}
        <div className="flex items-center justify-between mt-3 gap-3">
          <div className="font-semibold text-2xl">
            {priceToShow.toLocaleString("ru-RU")} ₸
          </div>

          <AddToCartButton
            productId={product.id}
            variantId={selectedVariant?.id ?? null}
            disabled={!inStock}
            maxStock={stockToUse}
          />
        </div>

        {/* НАЛИЧИЕ */}
        <div
          className={
            "mt-1 text-xs " +
            (inStock ? "text-emerald-700" : "text-gray-500")
          }
        >
          {inStock ? `В наличии: ${stockToUse}` : "Под заказ / нет"}
        </div>

        {/* НИЖНЯЯ СТРОКА */}
        <div className="mt-2 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {brandName} • {product.category}
          </div>

          <Link
            href="/shop"
            className="text-xs text-gray-600 hover:underline"
          >
            ← Вернуться в каталог
          </Link>
        </div>
      </div>

      {/* ПРАВАЯ КОЛОНКА */}
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">{product.name}</h1>

        <div className="text-gray-600 whitespace-pre-line">
          {product.description}
        </div>

        <Link
          href={`/ask?productId=${encodeURIComponent(product.id)}`}
          className="inline-block px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm"
        >
          Спросить о товаре
        </Link>
      </div>
    </div>
  );
}
