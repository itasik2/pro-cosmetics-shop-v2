"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function NewProductsFilter() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const enabled = searchParams.get("sort") === "new";

  function toggle() {
    const params = new URLSearchParams(searchParams.toString());
    if (enabled) params.delete("sort");
    else params.set("sort", "new");

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
      <input
        type="checkbox"
        checked={enabled}
        onChange={toggle}
        className="h-4 w-4 accent-gray-900"
      />
      <span>Новинки</span>
    </label>
  );
}
