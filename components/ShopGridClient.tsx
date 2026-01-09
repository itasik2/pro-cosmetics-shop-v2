"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard from "@/components/ProductCard";

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
};

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
  variants?: Variant[] | null;
};

type ActiveControl = "favorites" | null;

function readFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem("favorites");
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(arr.map(String));
  } catch {
    return new Set();
  }
}

export default function ShopGridClient({ products }: { products: Product[] }) {
  const [activeControl, setActiveControl] = useState<ActiveControl>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const syncFav = () => setFavIds(readFavorites());

  useEffect(() => {
    syncFav();
    const onSync = () => syncFav();
    window.addEventListener("favorites:changed", onSync);
    window.addEventListener("storage-sync", onSync);
    return () => {
      window.removeEventListener("favorites:changed", onSync);
      window.removeEventListener("storage-sync", onSync);
    };
  }, []);

  const visible = useMemo(() => {
    if (activeControl !== "favorites") return products;
    return products.filter((p) => favIds.has(p.id));
  }, [activeControl, favIds, products]);

  const favCount = favIds.size;

  return (
    <>
      {/* КНОПКИ УПРАВЛЕНИЯ */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setActiveControl((v) => (v === "favorites" ? null : "favorites"))
          }
          className={
            "relative px-3 py-1 rounded-full text-sm border transition " +
            (activeControl === "favorites"
              ? "bg-black text-white border-black"
              : "bg-white text-gray-700 hover:bg-gray-50")
          }
        >
          Избранное
          {favCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-gray-200 text-gray-800 text-[10px] px-2">
              {favCount}
            </span>
          )}
        </button>
      </div>

      {/* СЕТКА */}
      {visible.length === 0 ? (
        <div className="text-sm text-gray-500 mt-4">
          {activeControl === "favorites"
            ? "В избранном пока нет товаров."
            : "Товары не найдены."}
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
