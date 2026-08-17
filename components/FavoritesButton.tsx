"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function readFavCount(): number {
  try {
    const raw = localStorage.getItem("favorites");
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return 0;
    return parsed.map((x) => String(x)).filter(Boolean).length;
  } catch {
    return 0;
  }
}

export default function FavoritesButton() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const favMode = (sp.get("fav") || "") === "1";

  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(readFavCount());
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

  const badge = useMemo(() => count, [count]);

  function toggleFav() {
    const params = new URLSearchParams(sp.toString());

    if (favMode) params.delete("fav");
    else params.set("fav", "1");

    const qs = params.toString();
    const nextUrl = qs ? `${pathname}?${qs}` : pathname;

    router.push(nextUrl, { scroll: false });
    // router.refresh(); 
    // <-- КЛЮЧЕВОЕ: гарантируем перерасчёт списка/сервера
  }

  return (
    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
      <input
        type="checkbox"
        checked={favMode}
        onChange={toggleFav}
        className="h-4 w-4 accent-gray-900"
      />
      <span>Избранное</span>

      {badge > 0 && (
        <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-gray-100 text-[11px] leading-[18px] text-center text-gray-700 border border-gray-200">
          {badge}
        </span>
      )}
    </label>
  );
}
