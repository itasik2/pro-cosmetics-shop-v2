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
    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
      <input
        type="checkbox"
        checked={inStockMode}
        onChange={toggle}
        className="h-4 w-4 accent-gray-900"
      />
      <span>В наличии</span>
    </label>
  );
}
