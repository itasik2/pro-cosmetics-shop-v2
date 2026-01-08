"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard from "@/components/ProductCard";

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
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

function readFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem("favorites");
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export default function ShopGridClient({ products }: { products: Product[] }) {
  // Фильтр "только избранное" теперь включается извне (кнопкой в ShopPage)
  const [onlyFav, setOnlyFav] = useState(false);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const syncFav = () => setFavIds(readFavorites());

  useEffect(() => {
    syncFav();

    const onSync = () => syncFav();

    // стандартная синхронизация (между вкладками)
    window.addEventListener("storage", onSync);

    // твой существующий кастомный евент
    window.addEventListener("storage-sync", onSync as any);

    // новый евент: если где-то в приложении меняют избранное
    window.addEventListener("favorites:changed", onSync as any);

    // новый евент: кнопка "Избранное" в шапке каталога
    // Логика: переключаем режим "только избранное"
    const onOpen = () => setOnlyFav((v) => !v);
    window.addEventListener("favorites:open", onOpen as any);

    return () => {
      window.removeEventListener("storage", onSync);
      window.removeEventListener("storage-sync", onSync as any);
      window.removeEventListener("favorites:changed", onSync as any);
      window.removeEventListener("favorites:open", onOpen as any);
    };
  }, []);

  const visible = useMemo(() => {
    if (!onlyFav) return products;
    return products.filter((p) => favIds.has(p.id));
  }, [onlyFav, favIds, products]);

  return (
    <>
      {/* Сетка товаров */}
      {visible.length === 0 ? (
        <div className="text-sm text-gray-500 mt-4">
          {onlyFav ? "Нет товаров в избранном." : "Товары не найдены."}
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