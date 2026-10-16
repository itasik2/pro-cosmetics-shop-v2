"use client";
import {
  emptyProductFilters,
  type ProductFilters,
} from "@/lib/adminProductFilters";

export default function ProductFiltersBar({
  value,
  onChange,
  counts,
  categories,
  brands,
  suppliers,
}: {
  value: ProductFilters;
  onChange: (value: ProductFilters) => void;
  counts: { all: number; draft: number; published: number };
  categories: { value: string; label: string }[];
  brands: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}) {
  function set<K extends keyof ProductFilters>(
    key: K,
    next: ProductFilters[K],
  ) {
    onChange({ ...value, [key]: next });
  }
  return (
    <section
      aria-label="Фильтры товаров"
      className="space-y-3 rounded-2xl border bg-white p-4"
    >
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "Все"],
            ["draft", "Черновики"],
            ["published", "Опубликованные"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value.publication === key}
            onClick={() => set("publication", key)}
            className={
              "rounded-full border px-3 py-2 text-sm " +
              (value.publication === key
                ? "bg-gray-800 text-white"
                : "bg-white")
            }
          >
            {label} · {counts[key]}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <select
          aria-label="Категория товаров"
          value={value.category}
          onChange={(e) => set("category", e.target.value)}
          className="min-w-0 rounded-xl border bg-white p-2 text-sm"
        >
          <option value="">Все категории</option>
          {categories.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Бренд товаров"
          value={value.brand}
          onChange={(e) => set("brand", e.target.value)}
          className="min-w-0 rounded-xl border bg-white p-2 text-sm"
        >
          <option value="">Все бренды</option>
          {brands.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Поставщик товаров"
          value={value.supplier}
          onChange={(e) => set("supplier", e.target.value)}
          className="min-w-0 rounded-xl border bg-white p-2 text-sm"
        >
          <option value="">Все поставщики</option>
          {suppliers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Наличие товаров"
          value={value.stock}
          onChange={(e) =>
            set("stock", e.target.value as ProductFilters["stock"])
          }
          className="min-w-0 rounded-xl border bg-white p-2 text-sm"
        >
          <option value="all">Любое наличие</option>
          <option value="available">В наличии</option>
          <option value="empty">Нет в наличии</option>
        </select>
        <select
          aria-label="Заполнение товаров"
          value={value.content}
          onChange={(e) =>
            set("content", e.target.value as ProductFilters["content"])
          }
          className="min-w-0 rounded-xl border bg-white p-2 text-sm"
        >
          <option value="all">Любое заполнение</option>
          <option value="no-photo">Без фото</option>
          <option value="no-description">Без описания</option>
          <option value="variants">С вариантами</option>
          <option value="no-variants">Без вариантов</option>
          <option value="review">Требуют проверки</option>
          <option value="new">Новинки</option>
          <option value="popular">Популярные</option>
        </select>
      </div>
      {JSON.stringify(value) !== JSON.stringify(emptyProductFilters) && (
        <button
          type="button"
          onClick={() => onChange({ ...emptyProductFilters })}
          className="text-xs underline"
        >
          Сбросить фильтры
        </button>
      )}
    </section>
  );
}
