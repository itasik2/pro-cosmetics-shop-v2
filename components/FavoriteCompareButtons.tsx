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
        "h-9 w-9 rounded-full border grid place-items-center transition " +
        (fav ? "border-red-500" : "border-gray-300 hover:bg-gray-50")
      }
    >
      <svg
        viewBox="0 0 24 24"
        strokeWidth="2"
        className={
          "h-5 w-5 transition " +
          (fav
            ? "fill-red-500 stroke-red-500"
            : "fill-transparent stroke-red-500")
        }
      >
        <path d="M12 21s-6.716-4.434-9.192-7.363C.71 11.118 1.23 7.5 4.5 6.5c2.03-.62 3.87.27 4.5 1.5.63-1.23 2.47-2.12 4.5-1.5 3.27 1 3.79 4.618 1.692 7.137C18.716 16.566 12 21 12 21z" />
      </svg>
    </button>
  );
}
