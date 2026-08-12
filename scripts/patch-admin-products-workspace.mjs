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

patch("app/admin/(private)/products/AdminProductsClient.tsx", [
  {
    label: "external search and refresh listeners",
    from: `  useEffect(() => {\n    load();\n  }, []);`,
    to: `  useEffect(() => {\n    void load();\n\n    const onProductsChanged = () => void load();\n    const onSearch = (event: Event) => {\n      const value = (event as CustomEvent<string>).detail || \"\";\n      setSearchQuery(value);\n    };\n\n    const savedSearch = window.sessionStorage.getItem(\"admin-product-search\") || \"\";\n    setSearchQuery(savedSearch);\n\n    window.addEventListener(\"products-changed\", onProductsChanged);\n    window.addEventListener(\"admin-product-search\", onSearch);\n    return () => {\n      window.removeEventListener(\"products-changed\", onProductsChanged);\n      window.removeEventListener(\"admin-product-search\", onSearch);\n    };\n    // load intentionally remains a local request helper.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);`,
  },
  {
    label: "remove old search field",
    from: `\n        <div className="flex gap-2">\n          <input\n            type="search"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder="Поиск: название, бренд, SKU, объём…"\n            className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-500"\n          />\n          {searchQuery && (\n            <button\n              type="button"\n              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"\n              onClick={() => setSearchQuery("")}\n            >\n              Очистить\n            </button>\n          )}\n        </div>\n`,
    to: `\n`,
  },
]);

patch("app/admin/(private)/products/DraftProductsPublisher.tsx", [
  {
    label: "collapsible draft start",
    from: `  return (\n    <section className="rounded-2xl border p-4 space-y-4">\n      <div>\n        <h2 className="font-semibold">Черновики для публикации</h2>\n        <p className="mt-1 text-xs text-gray-500">\n          Здесь показываются только товары, у которых фото и описание полностью\n          одобрены. Можно опубликовать один товар отдельно либо выбрать несколько\n          и опубликовать их одной кнопкой.\n        </p>\n      </div>\n\n      {!loading && items.length > 0 && (`,
    to: `  return (\n    <section className="rounded-2xl border bg-white">\n      <details className="group">\n        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">\n          <div className="min-w-0">\n            <div className="flex flex-wrap items-center gap-2">\n              <h2 className="font-semibold">Черновики для публикации</h2>\n              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">\n                {loading ? "…" : items.length}\n              </span>\n            </div>\n            <p className="mt-1 text-xs text-gray-500">\n              Готовые после одобрения товары. Разверните блок только когда нужна публикация.\n            </p>\n          </div>\n          <span className="shrink-0 text-sm text-gray-500 group-open:hidden">Развернуть ↓</span>\n          <span className="hidden shrink-0 text-sm text-gray-500 group-open:inline">Свернуть ↑</span>\n        </summary>\n\n        <div className="space-y-4 border-t p-4">\n          <p className="text-xs text-gray-500">\n            Можно опубликовать один товар отдельно либо выбрать несколько и опубликовать их одной кнопкой.\n          </p>\n\n      {!loading && items.length > 0 && (`,
  },
  {
    label: "collapsible draft end",
    from: `      {success && (\n        <div className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">\n          {success}\n        </div>\n      )}\n    </section>`,
    to: `      {success && (\n        <div className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">\n          {success}\n        </div>\n      )}\n        </div>\n      </details>\n    </section>`,
  },
]);

patch("app/shop/page.tsx", [
  {
    label: "hide merged products in public shop",
    from: `  const where: Prisma.ProductWhereInput = {\n    isPublished: true,`,
    to: `  const where: Prisma.ProductWhereInput = {\n    isPublished: true,\n    enrichmentStatus: { not: \"MERGED\" },`,
  },
]);

patch("app/api/products/route.ts", [
  {
    label: "hide merged from publication queue",
    from: `      ? {\n          isPublished: false,\n          enrichmentProposals: {`,
    to: `      ? {\n          isPublished: false,\n          enrichmentStatus: { not: \"MERGED\" },\n          enrichmentProposals: {`,
  },
]);

console.log("Рабочий экран товаров обновлён");
