"use client";

import Link from "next/link";
import FavoriteButton from "./FavoriteCompareButtons";
import AddToCartButton from "./AddToCartButton";
import { useEffect, useState } from "react";
import { dec, getQty, inc } from "@/lib/cartStorage";

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
  };
};

function isNew(createdAt: Date | string, days = 14) {
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const diff = Date.now() - d.getTime();
  return diff <= days * 24 * 60 * 60 * 1000;
}

export default function ProductCard({ product }: ProductCardProps) {
  const inStock = product.stock > 0;
  const newBadge = isNew(product.createdAt, 14);

  const [inCartQty, setInCartQty] = useState(0);

  const syncCartQty = () => setInCartQty(getQty(product.id));

  useEffect(() => {
    syncCartQty();
    const onSync = () => syncCartQty();
    window.addEventListener("storage", onSync);
    window.addEventListener("storage-sync", onSync);
    return () => {
      window.removeEventListener("storage", onSync);
      window.removeEventListener("storage-sync", onSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const incCart = () => {
    if (!inStock) return;
    inc(product.id, product.stock);
    syncCartQty();
  };

  const decCart = () => {
    dec(product.id);
    syncCartQty();
  };

  return (
    <div className="card relative">
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

      <div className="aspect-square w-full bg-gray-100 rounded-xl mb-3 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>

      <div className="text-sm text-gray-500">
        {product.brand?.name ?? product.category}
      </div>

      <h3 className="font-semibold line-clamp-2">{product.name}</h3>

      <div className="flex items-center justify-between mt-2 gap-2">
        <div className="font-semibold">
          {Number(product.price).toLocaleString("ru-RU")} ₸
        </div>

        {/* Покупка из каталога */}
        {inCartQty > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-xl border hover:bg-gray-50"
              onClick={decCart}
            >
              −
            </button>

            <div className="w-10 text-center text-sm font-semibold">
              {inCartQty}
            </div>

            <button
              type="button"
              className="px-3 py-2 rounded-xl border hover:bg-gray-50 disabled:opacity-50"
              onClick={incCart}
              disabled={!inStock || inCartQty >= product.stock}
            >
              +
            </button>

            {/* Кнопка-статус. Клик оставляем: добавит 1, но + уже рядом. */}
            <AddToCartButton
              productId={product.id}
              disabled={!inStock}
              maxStock={product.stock}
              goToCartOnClick
            />
          </div>
        ) : (
          <AddToCartButton
            productId={product.id}
            disabled={!inStock}
            maxStock={product.stock}
          />
        )}
      </div>

      <div
        className={
          "mt-1 text-xs " + (inStock ? "text-emerald-700" : "text-gray-500")
        }
      >
        {inStock ? `В наличии: ${product.stock}` : "Под заказ/нет"}
      </div>

      {/* Подробнее оставляем как вторичное действие */}
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
