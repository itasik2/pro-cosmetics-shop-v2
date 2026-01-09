"use client";

import { useEffect, useState } from "react";

type Props = { productId: string };

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();

    // нормализуем: только строки, без пустых
    const ids = parsed.map((x) => String(x)).filter(Boolean);
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>) {
  // гарантируем уникальность и чистые строки
  const uniq = Array.from(new Set(Array.from(set).map((x) => String(x)).filter(Boolean)));

  localStorage.setItem(key, JSON.stringify(uniq));

  // КЛЮЧЕВОЕ: в этой же вкладке "storage" НЕ сработает, поэтому шлём свои события
  window.dispatchEvent(new Event("favorites:changed"));
  window.dispatchEvent(new Event("storage-sync"));
}

export default function FavoriteButton({ productId }: Props) {
  const favKey = "favorites";
  const [fav, setFav] = useState(false);

  const sync = () => setFav(readSet(favKey).has(productId));

  useEffect(() => {
    sync();

    const onStorage = (e: StorageEvent) => {
      // сработает в другой вкладке
      if (e.key === favKey) sync();
    };

    const onSync = () => sync();

    window.addEventListener("storage", onStorage);
    window.addEventListener("storage-sync", onSync as any);
    window.addEventListener("favorites:changed", onSync as any);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("storage-sync", onSync as any);
      window.removeEventListener("favorites:changed", onSync as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const toggle = () => {
    const set = readSet(favKey);
    if (set.has(productId)) set.delete(productId);
    else set.add(productId);

    writeSet(favKey, set);

    // локально обновим сразу, не дожидаясь слушателей
    setFav(set.has(productId));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={fav ? "Убрать из избранного" : "В избранное"}
      title={fav ? "В избранном" : "Добавить в избранное"}
      className={
        "h-9 w-9 rounded-full border grid place-items-center transition active:scale-95 " +
        (fav ? "border-red-500" : "border-gray-300 hover:bg-gray-50")
      }
    >
      <svg
        viewBox="0 0 24 24"
        className={
          "h-5 w-5 transition " +
          (fav ? "fill-red-500 stroke-red-500" : "fill-transparent stroke-red-500")
        }
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    </button>
  );
}
