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
  const sp = useSearchParams();
  const favMode = (sp.get("fav") || "") === "1";

  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sync = () => setFavIds(readFavorites());
    sync();

    const onSync = () => sync();
    window.addEventListener("favorites:changed", onSync as any);
    window.addEventListener("storage-sync", onSync as any);
    window.addEventListener("storage", onSync as any);

    return () => {
      window.removeEventListener("favorites:changed", onSync as any);
      window.removeEventListener("storage-sync", onSync as any);
      window.removeEventListener("storage", onSync as any);
    };
  }, []);

  const visible = useMemo(() => {
    if (!favMode) return products;
    // порядок сохраняется, значит сортировка (серверная) будет работать и внутри избранного
    return products.filter((p) => favIds.has(p.id));
  }, [favMode, favIds, products]);

  return visible.length === 0 ? (
    <div className="text-sm text-gray-500 mt-4">
      {favMode ? "Нет товаров в избранном." : "Товары не найдены."}
    </div>
  ) : (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mt-4">
      {visible.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
