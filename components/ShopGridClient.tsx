"use client";

import { useEffect, useState } from "react";
import ProductCard from "@/components/ProductCard";
import ListLoadStatus from "@/components/ListLoadStatus";
import useCatalogProducts from "@/components/useCatalogProducts";
import type { CatalogBatch, CatalogSource } from "@/lib/catalogTypes";

const NO_FAVORITES: string[] = [];
const BRAND_IMAGE_SIZES = "(min-width: 1152px) 230px, (min-width: 768px) calc((100vw - 232px) / 4), (min-width: 640px) calc((100vw - 132px) / 2), calc((100vw - 116px) / 2)";

function readFavorites(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem("favorites") || "[]");
    return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))].sort() : [];
  } catch { return []; }
}

type Props = { batch: CatalogBatch; source: CatalogSource; layout?: "catalog" | "brand" };

export default function ShopGridClient({ batch, source, layout = "catalog" }: Props) {
  const favMode = source.kind === "catalog" && source.query.fav === "1";
  const [favorites, setFavorites] = useState<string[] | null>(null);
  useEffect(() => {
    if (!favMode) return;
    const sync = () => {
      const next = readFavorites();
      setFavorites((current) => current && current.length === next.length && current.every((id, index) => id === next[index]) ? current : next);
    };
    sync();
    window.addEventListener("favorites:changed", sync);
    window.addEventListener("storage-sync", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("favorites:changed", sync);
      window.removeEventListener("storage-sync", sync);
      window.removeEventListener("storage", sync);
    };
  }, [favMode]);
  if (favMode && favorites === null) return <p role="status" className="mt-4 text-sm text-gray-500">Загрузка избранного…</p>;
  if (favMode && !favorites?.length) return <p className="mt-4 text-sm text-gray-500">Нет товаров в избранном.</p>;
  const ids = favMode ? favorites! : NO_FAVORITES;
  return <CatalogProductsList key={JSON.stringify([source, batch, ids])} batch={batch} source={source}
    layout={layout} favorites={ids} needsInitial={favMode} />;
}

function CatalogProductsList({ batch, source, layout, favorites, needsInitial }: Props & { favorites: string[]; needsInitial: boolean }) {
  const list = useCatalogProducts(batch, source, favorites, needsInitial);
  return <div aria-busy={list.loading}>
    <div className={layout === "brand" ? "grid grid-cols-2 md:grid-cols-4 gap-4" : "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mt-4"}>
      {list.products.map((product, index) => <ProductCard key={product.id} product={product} priority={index === 0}
        headingLevel={2} imageSizes={layout === "brand" ? BRAND_IMAGE_SIZES : undefined} />)}
    </div>
    {!list.products.length && !list.loading && !list.error && <p className="mt-4 text-sm text-gray-500">{needsInitial ? "Нет товаров в избранном." : "Товары не найдены."}</p>}
    {list.loading && <p role="status" className="py-3 text-center text-sm text-gray-500">Загрузка товаров…</p>}
    {list.error && <div role="alert" className="py-3 text-center text-sm text-gray-600">
      <p>{list.error}</p><button type="button" className="btn-secondary mt-2" onClick={() => void list.retry()}>Повторить загрузку</button>
    </div>}
    <ListLoadStatus count={list.products.length} total={list.total} endRef={list.endRef} onRevealAll={list.revealAll} />
  </div>;
}
