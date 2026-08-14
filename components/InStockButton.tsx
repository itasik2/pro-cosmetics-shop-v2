"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function InStockButton() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const inStockMode = (sp.get("instock") || "") === "1";

  function toggle() {
    const params = new URLSearchParams(sp.toString());

    if (inStockMode) params.delete("instock");
    else params.set("instock", "1");

    const qs = params.toString();
    const nextUrl = qs ? `${pathname}?${qs}` : pathname;

    router.push(nextUrl, { scroll: false });
    // router.refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={
        "inline-flex min-h-8 items-center justify-center gap-2 rounded-full border px-3 py-1 text-sm transition " +
        (inStockMode
          ? "bg-black text-white border-black"
          : "bg-white text-gray-700 hover:bg-gray-50")
      }
    >
      В наличии
    </button>
  );
}
