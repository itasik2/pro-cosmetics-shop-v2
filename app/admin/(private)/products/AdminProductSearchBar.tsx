"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "admin-product-search";
const EVENT_NAME = "admin-product-search";

function broadcast(value: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT_NAME, { detail: value }));
}

export default function AdminProductSearchBar() {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const saved = window.sessionStorage.getItem(STORAGE_KEY) || "";
    setQuery(saved);
    broadcast(saved);
  }, []);

  function update(value: string) {
    setQuery(value);
    window.sessionStorage.setItem(STORAGE_KEY, value);
    broadcast(value);
  }

  return (
    <section className="sticky top-2 z-20 rounded-2xl border bg-white/95 p-3 shadow-sm backdrop-blur sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <label htmlFor="admin-product-search" className="sr-only">
            Поиск товара
          </label>
          <input
            id="admin-product-search"
            type="search"
            value={query}
            onChange={(event) => update(event.target.value)}
            placeholder="Поиск товара: название, бренд, поставщик, SKU, объём…"
            className="w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none transition focus:border-gray-500"
          />
        </div>
        {query && (
          <button
            type="button"
            className="rounded-xl border px-4 py-3 text-sm hover:bg-gray-50"
            onClick={() => update("")}
          >
            Очистить
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Фильтрует список товаров ниже. Поиск учитывает также SKU и объёмы вариантов.
      </p>
    </section>
  );
}
