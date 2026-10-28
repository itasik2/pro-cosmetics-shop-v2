"use client";

import type { Ref } from "react";

export default function ListLoadStatus({ count, total, endRef, onRevealAll }: {
  count: number; total: number; endRef: Ref<HTMLDivElement>; onRevealAll: () => void;
}) {
  if (!total) return null;
  return <div ref={endRef} role="status" className="py-4 text-center text-sm text-gray-500">
    Показано {count} из {total}
    {count < total && <>
      <span className="block text-xs">Остальные товары появятся при прокрутке</span>
      <button type="button" className="sr-only focus:not-sr-only focus:underline" onClick={onRevealAll}>
        Показать все товары
      </button>
    </>}
  </div>;
}
