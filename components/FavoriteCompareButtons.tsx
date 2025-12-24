"use client";

import { useEffect, useState } from "react";

type Props = { productId: string };

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>) {
  localStorage.setItem(key, JSON.stringify(Array.from(set)));
  window.dispatchEvent(new Event("storage-sync"));
}

export default function FavoriteCompareButtons({ productId }: Props) {
  const favKey = "favorites";
  const cmpKey = "compare";

  const [fav, setFav] = useState(false);
  const [cmp, setCmp] = useState(false);

  const sync = () => {
    setFav(readSet(favKey).has(productId));
    setCmp(readSet(cmpKey).has(productId));
  };

  useEffect(() => {
    sync();
    const onSync = () => sync();
    window.addEventListener("storage", onSync);
    window.addEventListener("storage-sync", onSync);
    return () => {
      window.removeEventListener("storage", onSync);
      window.removeEventListener("storage-sync", onSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const toggle = (key: string) => {
    const set = readSet(key);
    if (set.has(productId)) set.delete(productId);
    else set.add(productId);
    writeSet(key, set);
    sync();
  };

  const btnClass = (active: boolean) =>
    "h-9 w-9 rounded-full border text-xs grid place-items-center transition " +
    (active
      ? "bg-black text-white border-black"
      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50");

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={btnClass(fav)}
        onClick={() => toggle(favKey)}
        aria-label={fav ? "Убрать из избранного" : "В избранное"}
        title={fav ? "В избранном" : "Добавить в избранное"}
      >
        ❤
      </button>

      <button
        type="button"
        className={btnClass(cmp)}
        onClick={() => toggle(cmpKey)}
        aria-label={cmp ? "Убрать из сравнения" : "В сравнение"}
        title={cmp ? "В сравнении" : "Добавить в сравнение"}
      >
        ⇄
      </button>
    </div>
  );
}
