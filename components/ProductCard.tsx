"use client";

import Link from "next/link";
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

        {/* Одна кнопка: "Купить" -> "- qty +", центр открывает корзину */}
        <AddToCartButton
          productId={product.id}
          disabled={!inStock}
          maxStock={product.stock}
        />
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
