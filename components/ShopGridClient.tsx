"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();

  // URL-параметры (нужны для сброса фильтра при смене сортировки/бренда)
  const sortParam = searchParams.get("sort") || "new";
  const brandParam = searchParams.get("brand") || "";

  const [onlyFav, setOnlyFav] = useState(false);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const syncFav = () => setFavIds(readFavorites());

  // 1) Подхват избранного и синхронизация между вкладками/компонентами
  useEffect(() => {
    syncFav();

    const onStorage = (e: StorageEvent) => {
      if (e.key === "favorites") syncFav();
    };

    const onSync = () => syncFav();

    window.addEventListener("storage", onStorage);
    window.addEventListener("favorites:changed", onSync as any);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("favorites:changed", onSync as any);
    };
  }, []);

  // 2) Обработчик клика по кнопке в шапке (FavoritesButton)
  useEffect(() => {
    const onOpen = () => {
      setOnlyFav((v) => {
        const next = !v;
        window.dispatchEvent(new CustomEvent("favorites:state", { detail: next }));
        return next;
      });
    };

    window.addEventListener("favorites:open", onOpen as any);

    // сообщим начальное состояние кнопке
    window.dispatchEvent(new CustomEvent("favorites:state", { detail: onlyFav }));

    return () => window.removeEventListener("favorites:open", onOpen as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3) Сброс фильтра "только избранное" при смене сортировки или бренда
  useEffect(() => {
    setOnlyFav(false);
    window.dispatchEvent(new CustomEvent("favorites:state", { detail: false }));
  }, [sortParam, brandParam]);

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