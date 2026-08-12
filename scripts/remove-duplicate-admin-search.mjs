import fs from "node:fs";

const path = "app/admin/(private)/products/AdminProductsClient.tsx";
let text = fs.readFileSync(path, "utf8");

const block = `\n        <div className="flex gap-2">\n          <input\n            type="search"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder="Поиск: название, бренд, SKU, объём…"\n            className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:border-gray-500"\n          />\n          {searchQuery && (\n            <button\n              type="button"\n              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"\n              onClick={() => setSearchQuery("")}\n            >\n              Очистить\n            </button>\n          )}\n        </div>\n`;

if (!text.includes(block)) {
  throw new Error("Нижняя форма поиска не найдена");
}

text = text.replace(block, "\n");
fs.writeFileSync(path, text);
console.log("Нижняя форма поиска удалена");
