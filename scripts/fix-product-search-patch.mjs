import fs from "node:fs";

const path = "scripts/patch-product-search.mjs";
let text = fs.readFileSync(path, "utf8");

const replacements = [
  [
    '{searchQuery.trim() ? `${filteredItems.length} из ${items.length}` : `${items.length} поз.`}',
    '{searchQuery.trim() ? filteredItems.length + " из " + items.length : items.length + " поз."}',
  ],
  [
    '{items.length === 0 ? "Пока пусто" : `По запросу «${searchQuery.trim()}» ничего не найдено`}',
    '{items.length === 0 ? "Пока пусто" : "По запросу «" + searchQuery.trim() + "» ничего не найдено"}',
  ],
];

for (const [from, to] of replacements) {
  if (text.includes(to)) continue;
  if (!text.includes(from)) throw new Error(`Не найден участок: ${from}`);
  text = text.replace(from, to);
}

fs.writeFileSync(path, text);
console.log("Генератор поиска исправлен");
