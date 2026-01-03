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

export default function FavoriteButton({ productId }: Props) {
  const favKey = "favorites";
  const [fav, setFav] = useState(false);

  const sync = () => setFav(readSet(favKey).has(productId));

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

  const toggle = () => {
    const set = readSet(favKey);
    if (set.has(productId)) set.delete(productId);
    else set.add(productId);
    writeSet(favKey, set);
    sync();
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
          (fav
            ? "fill-red-500 stroke-red-500"
            : "fill-transparent stroke-red-500")
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
