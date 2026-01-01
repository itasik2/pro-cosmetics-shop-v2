"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard from "@/components/ProductCard";

type Product = {
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

function readFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem("favorites");
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export default function ShopGridClient({ products }: { products: Product[] }) {
  const [onlyFav, setOnlyFav] = useState(false);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const syncFav = () => setFavIds(readFavorites());

  useEffect(() => {
    syncFav();
    const onSync = () => syncFav();
    window.addEventListener("storage", onSync);
    window.addEventListener("storage-sync", onSync);
    return () => {
      window.removeEventListener("storage", onSync);
      window.removeEventListener("storage-sync", onSync);
    };
  }, []);

  const visible = useMemo(() => {
    if (!onlyFav) return products;
    return products.filter((p) => favIds.has(p.id));
  }, [onlyFav, favIds, products]);

  return (
    <>
      {/* Фильтр */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOnlyFav((v) => !v)}
          className={
            "px-3 py-1 rounded-full text-sm border transition " +
            (onlyFav
              ? "bg-red-500 text-white border-red-500"
              : "bg-white text-gray-700 hover:bg-gray-50")
          }
        >
          ❤ Избранное
        </button>
      </div>

      {/* Сетка товаров */}
      {visible.length === 0 ? (
        <div className="text-sm text-gray-500 mt-4">
          Нет товаров в избранном.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mt-4">
          {visible.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </>
  );
}