"use client";

import type { Ref } from "react";
import { useSiteLocale, useUiText } from "@/components/LocaleProvider";

export default function ListLoadStatus({ count, total, endRef, onRevealAll, hasMore = count < total }: {
  count: number; total: number; endRef: Ref<HTMLDivElement>; onRevealAll: () => void; hasMore?: boolean;
}) {
  const t = useUiText();
  const locale = useSiteLocale();
  if (!total) return null;
  return <div ref={endRef} role="status" className="py-4 text-center text-sm text-gray-500">
    {locale === "kk" ? `${total} ішінен ${count} көрсетілді` : locale === "en" ? `Showing ${count} of ${total}` : `Показано ${count} из ${total}`}
    {hasMore && <>
      <span className="block text-xs">{t("Остальные товары появятся при прокрутке")}</span>
      <button type="button" className="sr-only focus:not-sr-only focus:underline" onClick={onRevealAll}>
        {t("Показать все товары")}
      </button>
    </>}
  </div>;
}
