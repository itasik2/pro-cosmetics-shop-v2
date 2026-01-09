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
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x)).filter(Boolean));
  } catch {
    return new Set();
  }
}

export default function ShopGridClient({ products }: { products: Product[] }) {
  const searchParams = useSearchParams();
  const sortParam = searchParams.get("sort") || "new";
  const brandParam = searchParams.get("brand") || "";

  const [onlyFav, setOnlyFav] = useState(false);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const syncFav = () => setFavIds(readFavorites());

  // синхронизация избранного (главное: favorites:changed)
  useEffect(() => {
    syncFav();

    const onChanged = () => syncFav();

    window.addEventListener("favorites:changed", onChanged as any);
    return () => window.removeEventListener("favorites:changed", onChanged as any);
  }, []);

  // кнопка в шапке
  useEffect(() => {
    const onOpen = () => {
      setOnlyFav((v) => {
        const next = !v;
        window.dispatchEvent(new CustomEvent("favorites:state", { detail: next }));
        return next;
      });
    };

    window.addEventListener("favorites:open", onOpen as any);
    window.dispatchEvent(new CustomEvent("favorites:state", { detail: onlyFav }));

    return () => window.removeEventListener("favorites:open", onOpen as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // сброс фильтра при смене сортировки/бренда
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
