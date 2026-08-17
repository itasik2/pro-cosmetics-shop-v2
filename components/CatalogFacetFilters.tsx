"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type FilterOption = {
  slug: string;
  label: string;
};

function parseValues(value: string | null) {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export default function CatalogFacetFilters({
  brands,
  categories,
}: {
  brands: FilterOption[];
  categories: FilterOption[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedBrands = useMemo(
    () => parseValues(searchParams.get("brand")),
    [searchParams],
  );
  const selectedCategories = useMemo(
    () => parseValues(searchParams.get("category")),
    [searchParams],
  );

  function updateFilter(param: "brand" | "category", slug: string, checked: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    const values = new Set(parseValues(params.get(param)));

    if (checked) values.add(slug);
    else values.delete(slug);

    const nextValues = Array.from(values);
    if (nextValues.length) params.set(param, nextValues.join(","));
    else params.delete(param);

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearFilter(param: "brand" | "category") {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(param);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearBoth() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("brand");
    params.delete("category");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      <FilterDropdown
        title="Бренды"
        options={brands}
        selected={selectedBrands}
        onChange={(slug, checked) => updateFilter("brand", slug, checked)}
        onClear={() => clearFilter("brand")}
      />
      <FilterDropdown
        title="Категории"
        options={categories}
        selected={selectedCategories}
        onChange={(slug, checked) => updateFilter("category", slug, checked)}
        onClear={() => clearFilter("category")}
      />
      {selectedBrands.length > 0 || selectedCategories.length > 0 ? (
        <button
          type="button"
          onClick={clearBoth}
          className="inline-flex min-h-10 items-center px-2 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900"
        >
          Сбросить выбор
        </button>
      ) : null}
    </div>
  );
}

function FilterDropdown({
  title,
  options,
  selected,
  onChange,
  onClear,
}: {
  title: string;
  options: FilterOption[];
  selected: string[];
  onChange: (slug: string, checked: boolean) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedLabels = options
    .filter((option) => selectedSet.has(option.slug))
    .map((option) => option.label);
  const summary =
    selectedLabels.length === 0
      ? title
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${title}: ${selectedLabels.length}`;

  return (
    <details
      className="relative"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span aria-hidden="true" className="text-xs text-gray-500">
          {open ? "▲" : "▼"}
        </span>
      </summary>

      <div className="absolute left-0 z-30 mt-2 max-h-80 w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border bg-white p-2 shadow-xl">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-gray-50">
          <input
            type="checkbox"
            checked={selected.length === 0}
            onChange={onClear}
            className="h-4 w-4 accent-gray-900"
          />
          <span>Все</span>
        </label>
        {options.map((option) => (
          <label
            key={option.slug}
            className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-gray-50"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(option.slug)}
              onChange={(event) => onChange(option.slug, event.target.checked)}
              className="h-4 w-4 accent-gray-900"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
