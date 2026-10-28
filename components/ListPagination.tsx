"use client";
import Link from "next/link";

export default function ListPagination({ page, pageCount, start, end, total, onPageChange, hrefForPage }: {
  page: number; pageCount: number; start: number; end: number; total: number;
  onPageChange?: (page: number) => void;
  hrefForPage?: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const control = (label: string, target: number, disabled: boolean) => hrefForPage && !disabled
    ? <Link className="btn-secondary min-h-11 px-4" href={hrefForPage(target)} prefetch={false}>{label}</Link>
    : <button type="button" className="btn-secondary min-h-11 px-4 disabled:opacity-40" disabled={disabled}
        onClick={() => onPageChange?.(target)}>{label}</button>;
  return <nav aria-label="Страницы списка товаров" className="my-4 flex flex-wrap items-center justify-between gap-3">
    <p role="status" className="text-sm text-gray-600">Товары {start}–{end} из {total} · Страница {page} из {pageCount}</p>
    <div className="flex gap-2">
      {control("Назад", page - 1, page <= 1)}
      {control("Далее", page + 1, page >= pageCount)}
    </div>
  </nav>;
}
