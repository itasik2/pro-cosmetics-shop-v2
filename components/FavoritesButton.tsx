"use client";

import { useEffect, useState } from "react";

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
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setCount(readFavCount());
    sync();

    const onChanged = () => sync();
    const onState = (e: any) => setActive(!!e.detail);

    window.addEventListener("favorites:changed", onChanged as any);
    window.addEventListener("favorites:state", onState as any);

    return () => {
      window.removeEventListener("favorites:changed", onChanged as any);
      window.removeEventListener("favorites:state", onState as any);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("favorites:open"))}
      className={
        "px-3 py-1 rounded-full text-sm border transition inline-flex items-center gap-2 " +
        (active
          ? "bg-black text-white border-black"
          : "bg-white text-gray-700 hover:bg-gray-50")
      }
    >
      <span>Избранное</span>

      {count > 0 ? (
        <span
          className={
            "min-w-[18px] h-[18px] px-1.5 rounded-full text-[11px] leading-[18px] text-center border " +
            (active
              ? "bg-white/15 text-white border-white/20"
              : "bg-gray-100 text-gray-700 border-gray-200")
          }
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}