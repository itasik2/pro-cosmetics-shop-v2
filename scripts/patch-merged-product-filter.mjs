import fs from "node:fs";

function patch(path, replacements) {
  let text = fs.readFileSync(path, "utf8");
  for (const [from, to, label] of replacements) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) throw new Error(`${path}: не найден участок ${label}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
}

patch("app/api/admin/price-imports/upload/route.ts", [
  [
    `      where: { supplierId: supplier.id },`,
    `      where: {\n        supplierId: supplier.id,\n        enrichmentStatus: { not: "MERGED" },\n      },`,
    "фильтр импорта",
  ],
]);

patch("app/api/products/route.ts", [
  [
    `      : undefined,`,
    `      : { enrichmentStatus: { not: "MERGED" } },`,
    "фильтр списка товаров",
  ],
]);

patch("app/api/admin/products/variant-merge/route.ts", [
  [
    `          enrichmentStatus: "MERGED",\n        },`,
    `          enrichmentStatus: "MERGED",\n          variants: null,\n        },`,
    "очистка вариантов архива",
  ],
]);

console.log("Архивные MERGED-товары исключены из рабочих потоков");
