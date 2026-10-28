"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import ProductCard from "@/components/ProductCard";
import ListPagination from "@/components/ListPagination";
import { CATALOG_PAGE_SIZE, paginateItems } from "@/lib/listPagination";

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
};

type Product = {
  id: string;
  slug: string;
  name: string;
  supplierSku?: string | null;
  image: string;
  shortDescription?: string | null;
  price: number;
  stock: number;
  isPopular: boolean;
  createdAt: Date | string;
  category: string;
  brand?: { name: string } | null;
  variants?: any;
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

function isInStock(p: Product) {
  const vars = Array.isArray(p.variants) ? p.variants : null;
  if (vars && vars.length > 0) return vars.some((v) => (Number(v.stock) || 0) > 0);
  return (Number(p.stock) || 0) > 0;
}

export default function ShopGridClient({ products, layout = "catalog" }: { products: Product[]; layout?: "catalog" | "brand" }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const favMode = layout === "catalog" && (sp.get("fav") || "") === "1";
  const inStockMode = layout === "catalog" && (sp.get("instock") || "") === "1";

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
    let list = products;

    if (favMode) {
      list = list.filter((p) => favIds.has(p.id));
    }

    if (inStockMode) {
      list = list.filter((p) => isInStock(p));
    }

    // порядок НЕ меняем -> сортировка (серверная) сохраняется и в избранном
    return list;
  }, [products, favMode, inStockMode, favIds]);
  const pagination = paginateItems(visible, Number(sp.get("page") || 1), CATALOG_PAGE_SIZE);

  return visible.length === 0 ? (
    <div className="text-sm text-gray-500 mt-4">
      {favMode ? "Нет товаров в избранном." : "Товары не найдены."}
    </div>
  ) : (
    <div>
      <div className={layout === "brand" ? "grid grid-cols-2 md:grid-cols-4 gap-4" : "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mt-4"}>
        {pagination.items.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
      <ListPagination {...pagination} hrefForPage={(page) => {
        const params = new URLSearchParams(sp.toString());
        if (page === 1) params.delete("page"); else params.set("page", String(page));
        return params.size ? `${pathname}?${params}` : pathname;
      }} />
    </div>
  );
}
