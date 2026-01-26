"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AddToCartButton from "@/components/AddToCartButton";

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
  image?: string;
};

type Product = {
  id: string;
  name: string;
  image: string;
  price: number;
  stock: number;
  description: string;
  category: string;
  brand?: { name: string } | null;
  variants?: any;
};

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

export default function ProductDetailsClient({ product }: { product: Product }) {
  const brandName = product.brand?.name ?? "—";

  const variants = useMemo(() => normalizeVariants(product.variants), [product.variants]);
  const hasVariants = variants.length > 0;

  const defaultVariant = hasVariants
    ? variants.find((v) => v.stock > 0) ?? variants[0]
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
    <div className="grid md:grid-cols-2 gap-8 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageToShow}
        alt={product.name}
        className="w-full rounded-3xl border object-cover max-h-[480px]"
      />

      <div className="space-y-4">
        <div className="text-sm text-gray-500">
          {brandName} • {product.category}
        </div>

        <h1 className="text-3xl font-bold">{product.name}</h1>

        {/* Варианты */}
        {hasVariants && (
          <div className="space-y-2">
            <div className="text-sm font-semibold">Варианты</div>
            <div className="flex flex-wrap gap-2">
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
                      (active
                        ? "bg-black text-white border-black"
                        : "bg-white text-gray-700 hover:bg-gray-50") +
                      (disabled ? " opacity-40 cursor-not-allowed" : "")
                    }
                    title={disabled ? "Нет в наличии" : ""}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>

            <div className={"text-xs " + (inStock ? "text-emerald-700" : "text-gray-500")}>
              {inStock ? `В наличии: ${stockToUse}` : "Нет в наличии"}
            </div>

            <div className="text-xs text-gray-500">
              Если у варианта задано фото — оно показывается при выборе. Иначе используется основное фото товара.
            </div>
          </div>
        )}

        <div className="text-gray-600 whitespace-pre-line">{product.description}</div>

        {/* Кнопка "Спросить о товаре" — как у тебя */}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/ask?productId=${encodeURIComponent(product.id)}`}
            className="px-4 py-2 rounded-xl border bg-white/80 backdrop-blur hover:bg-white transition text-sm"
          >
            Спросить о товаре
          </Link>

          <div className="text-xs text-gray-500">Откроется Q&amp;A с контекстом этого товара</div>
        </div>

        <div className="text-2xl font-semibold">{priceToShow.toLocaleString("ru-RU")} ₸</div>

        {/* В корзину: через localStorage (поддержка variantId) */}
        <div>
          <AddToCartButton
            productId={product.id}
            variantId={selectedVariant?.id ?? null}
            disabled={stockToUse <= 0}
            maxStock={stockToUse}
          />
        </div>

        <Link href="/shop" className="text-sm text-gray-500 hover:underline">
          ← Вернуться в каталог
        </Link>
      </div>
    </div>
  );
}
