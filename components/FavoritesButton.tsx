"use client";

import { useEffect, useMemo, useState } from "react";

function readFavCount(): number {
  try {
    const raw = localStorage.getItem("favorites");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export default function FavoritesButton() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(readFavCount());
    sync();

    const onStorage = (e: StorageEvent) => {
      if (e.key === "favorites") sync();
    };

    const onChanged = () => sync();

    window.addEventListener("storage", onStorage);
    window.addEventListener("favorites:changed", onChanged as any);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("favorites:changed", onChanged as any);
    };
  }, []);

  const label = useMemo(() => {
    return count > 0 ? `Избранное (${count})` : "Избранное";
  }, [count]);

  return (
    <button
      type="button"
      className="px-3 py-1 rounded-full text-sm border bg-white text-gray-700 hover:bg-gray-50"
      onClick={() => window.dispatchEvent(new CustomEvent("favorites:open"))}
    >
      {label}
    </button>
  );
}