import fs from "node:fs";

function patch(path, replacements) {
  let text = fs.readFileSync(path, "utf8");
  for (const { from, to, label } of replacements) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) throw new Error(`${path}: не найден участок ${label}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
}

patch("app/shop/page.tsx", [
  {
    label: "q search param",
    from: `    instock?: string;\n  };`,
    to: `    instock?: string;\n    q?: string;\n  };`,
  },
  {
    label: "metadata query",
    from: `  const sort = (searchParams?.sort || "").trim();\n\n  const brands =`,
    to: `  const sort = (searchParams?.sort || "").trim();\n  const searchQuery = (searchParams?.q || "").trim();\n\n  const brands =`,
  },
  {
    label: "metadata robots search",
    from: `    robots: sort ? { index: false, follow: true } : undefined,`,
    to: `    robots: sort || searchQuery ? { index: false, follow: true } : undefined,`,
  },
  {
    label: "search helpers",
    from: `function findCategory(slug: string) {\n  return CATEGORY_OPTIONS.find((item) => item.slug === slug) ?? null;\n}\n`,
    to: `function findCategory(slug: string) {\n  return CATEGORY_OPTIONS.find((item) => item.slug === slug) ?? null;\n}\n\nfunction normalizeSearch(value: unknown) {\n  return String(value || "")\n    .toLocaleLowerCase("ru-RU")\n    .replace(/ё/g, "е")\n    .replace(/[^a-zа-я0-9]+/gi, " ")\n    .replace(/\\s+/g, " ")\n    .trim();\n}\n\nfunction productMatchesSearch(\n  product: {\n    name: string;\n    category: string;\n    supplierSku: string | null;\n    brand: { name: string } | null;\n    variants: unknown;\n  },\n  query: string,\n) {\n  const normalizedQuery = normalizeSearch(query);\n  if (!normalizedQuery) return true;\n\n  const variantParts: string[] = [];\n  if (Array.isArray(product.variants)) {\n    for (const raw of product.variants) {\n      if (!raw || typeof raw !== "object") continue;\n      const variant = raw as Record<string, unknown>;\n      if (typeof variant.label === "string") variantParts.push(variant.label);\n      if (typeof variant.sku === "string") variantParts.push(variant.sku);\n    }\n  }\n\n  const haystack = normalizeSearch([\n    product.name,\n    product.brand?.name,\n    product.category,\n    product.supplierSku,\n    ...variantParts,\n  ].filter(Boolean).join(" "));\n\n  return normalizedQuery.split(" ").every((token) => haystack.includes(token));\n}\n`,
  },
  {
    label: "shop query",
    from: `  const instock = (searchParams?.instock || "").trim();\n\n  const brands =`,
    to: `  const instock = (searchParams?.instock || "").trim();\n  const searchQuery = (searchParams?.q || "").trim().slice(0, 120);\n\n  const brands =`,
  },
  {
    label: "select supplier sku",
    from: `      category: true,\n      brand: { select: { name: true } },`,
    to: `      category: true,\n      supplierSku: true,\n      brand: { select: { name: true } },`,
  },
  {
    label: "filter products",
    from: `  const productsForClient = products.map((product) => ({\n    ...product,\n    variants: toVariants(product.variants),\n  }));`,
    to: `  const productsForClient = products\n    .filter((product) => productMatchesSearch(product, searchQuery))\n    .map((product) => ({\n      ...product,\n      variants: toVariants(product.variants),\n    }));`,
  },
  {
    label: "sort query prop",
    from: `            currentInStock={instock}\n            value="new"`,
    to: `            currentInStock={instock}\n            currentQuery={searchQuery}\n            value="new"`,
  },
  {
    label: "sort query prop 2",
    from: `            currentInStock={instock}\n            value="price_asc"`,
    to: `            currentInStock={instock}\n            currentQuery={searchQuery}\n            value="price_asc"`,
  },
  {
    label: "sort query prop 3",
    from: `            currentInStock={instock}\n            value="price_desc"`,
    to: `            currentInStock={instock}\n            currentQuery={searchQuery}\n            value="price_desc"`,
  },
  {
    label: "search form",
    from: `      <div className="flex flex-wrap gap-2">\n        <FilterLink\n          isActive={!brandSlug}\n          href={buildHref("", categorySlug, sort, fav, instock)}`,
    to: `      <form action="/shop" method="get" className="flex flex-col gap-2 sm:flex-row sm:items-center">\n        <div className="relative flex-1">\n          <input\n            type="search"\n            name="q"\n            defaultValue={searchQuery}\n            placeholder="Поиск по названию, бренду, SKU или объёму"\n            className="w-full rounded-2xl border bg-white px-4 py-3 pr-10 text-sm outline-none transition focus:border-gray-500"\n          />\n          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>\n        </div>\n        {brandSlug && <input type="hidden" name="brand" value={brandSlug} />}\n        {categorySlug && <input type="hidden" name="category" value={categorySlug} />}\n        {sort && <input type="hidden" name="sort" value={sort} />}\n        {fav === "1" && <input type="hidden" name="fav" value="1" />}\n        {instock === "1" && <input type="hidden" name="instock" value="1" />}\n        <button type="submit" className="btn px-5 py-3">Найти</button>\n        {searchQuery && (\n          <Link\n            href={buildHref(brandSlug, categorySlug, sort, fav, instock, "")}\n            className="rounded-xl border px-4 py-3 text-center text-sm hover:bg-gray-50"\n          >\n            Очистить\n          </Link>\n        )}\n      </form>\n\n      {searchQuery && (\n        <div className="text-sm text-gray-500">\n          По запросу «{searchQuery}» найдено: {productsForClient.length}\n        </div>\n      )}\n\n      <div className="flex flex-wrap gap-2">\n        <FilterLink\n          isActive={!brandSlug}\n          href={buildHref("", categorySlug, sort, fav, instock, searchQuery)}`,
  },
  {
    label: "brand href query",
    from: `href={buildHref(brand.slug, categorySlug, sort, fav, instock)}`,
    to: `href={buildHref(brand.slug, categorySlug, sort, fav, instock, searchQuery)}`,
  },
  {
    label: "all category href query",
    from: `href={buildHref(brandSlug, "", sort, fav, instock)}`,
    to: `href={buildHref(brandSlug, "", sort, fav, instock, searchQuery)}`,
  },
  {
    label: "category href query",
    from: `href={buildHref(brandSlug, category.slug, sort, fav, instock)}`,
    to: `href={buildHref(brandSlug, category.slug, sort, fav, instock, searchQuery)}`,
  },
  {
    label: "build href query",
    from: `  instock: string,\n) {\n  const params = new URLSearchParams();`,
    to: `  instock: string,\n  searchQuery = "",\n) {\n  const params = new URLSearchParams();`,
  },
  {
    label: "set q",
    from: `  if (instock === "1") params.set("instock", "1");\n\n  const query = params.toString();`,
    to: `  if (instock === "1") params.set("instock", "1");\n  if (searchQuery) params.set("q", searchQuery);\n\n  const query = params.toString();`,
  },
  {
    label: "sort props query",
    from: `  currentInStock,\n  value,`,
    to: `  currentInStock,\n  currentQuery,\n  value,`,
  },
  {
    label: "sort type query",
    from: `  currentInStock: string;\n  value: string;`,
    to: `  currentInStock: string;\n  currentQuery: string;\n  value: string;`,
  },
  {
    label: "sort href query",
    from: `        currentInStock,\n      )}`,
    to: `        currentInStock,\n        currentQuery,\n      )}`,
  },
]);

patch("app/admin/(private)/products/AdminProductsClient.tsx", [
  {
    label: "useMemo import",
    from: `import { useEffect, useState, type ReactNode } from "react";`,
    to: `import { useEffect, useMemo, useState, type ReactNode } from "react";`,
  },
  {
    label: "search helpers admin",
    from: `async function readJson(response: Response) {\n  return response.json().catch(() => ({} as Record<string, unknown>));\n}\n`,
    to: `async function readJson(response: Response) {\n  return response.json().catch(() => ({} as Record<string, unknown>));\n}\n\nfunction normalizeSearch(value: unknown) {\n  return String(value || "")\n    .toLocaleLowerCase("ru-RU")\n    .replace(/ё/g, "е")\n    .replace(/[^a-zа-я0-9]+/gi, " ")\n    .replace(/\\s+/g, " ")\n    .trim();\n}\n\nfunction productMatchesSearch(product: Product, query: string) {\n  const normalizedQuery = normalizeSearch(query);\n  if (!normalizedQuery) return true;\n\n  const variantParts: string[] = [];\n  if (Array.isArray(product.variants)) {\n    for (const raw of product.variants) {\n      if (!raw || typeof raw !== "object") continue;\n      const variant = raw as VariantData;\n      if (variant.label != null) variantParts.push(String(variant.label));\n      if (variant.sku != null) variantParts.push(String(variant.sku));\n    }\n  }\n\n  const haystack = normalizeSearch([\n    product.name,\n    product.brand?.name,\n    product.supplier?.name,\n    product.supplierSku,\n    product.category,\n    ...variantParts,\n  ].filter(Boolean).join(" "));\n\n  return normalizedQuery.split(" ").every((token) => haystack.includes(token));\n}\n`,
  },
  {
    label: "search state",
    from: `  const [variantUploadingId, setVariantUploadingId] = useState<string | null>(null);`,
    to: `  const [variantUploadingId, setVariantUploadingId] = useState<string | null>(null);\n  const [searchQuery, setSearchQuery] = useState("");`,
  },
  {
    label: "filtered items",
    from: `  return (\n    <div className="grid md:grid-cols-2 gap-8">`,
    to: `  const filteredItems = useMemo(\n    () => items.filter((product) => productMatchesSearch(product, searchQuery)),\n    [items, searchQuery],\n  );\n\n  return (\n    <div className="grid md:grid-cols-2 gap-8">`,
  },
  {
    label: "admin heading count",
    from: `          <h2 className="text-xl font-semibold">Товары</h2>\n          <span className="text-sm text-gray-500">{items.length} поз.</span>\n        </div>\n\n        <div className="grid grid-cols-1 gap-3">\n          {items.map((product) => {`,
    to: `          <h2 className="text-xl font-semibold">Товары</h2>\n          <span className="text-sm text-gray-500">\n            {searchQuery.trim() ? `${filteredItems.length} из ${items.length}` : `${items.length} поз.`}\n          </span>\n        </div>\n\n        <div className="flex gap-2">\n          <input\n            type="search"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder="Поиск: название, бренд, SKU, объём…"\n            className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-500"\n          />\n          {searchQuery && (\n            <button\n              type="button"\n              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"\n              onClick={() => setSearchQuery("")}\n            >\n              Очистить\n            </button>\n          )}\n        </div>\n\n        <div className="grid grid-cols-1 gap-3">\n          {filteredItems.map((product) => {`,
  },
  {
    label: "admin empty state",
    from: `          {items.length === 0 && (\n            <div className="text-sm text-gray-500">Пока пусто</div>\n          )}`,
    to: `          {filteredItems.length === 0 && (\n            <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">\n              {items.length === 0 ? "Пока пусто" : `По запросу «${searchQuery.trim()}» ничего не найдено`}\n            </div>\n          )}`,
  },
]);

console.log("Поиск товаров добавлен в каталог и админку");
