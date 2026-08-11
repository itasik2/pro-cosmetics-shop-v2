import fs from "node:fs";
const path = "app/api/admin/products/variant-merge/route.ts";
let text = fs.readFileSync(path, "utf8");
const from = '          variants: null,';
const to = '          variants: [],';
if (!text.includes(to)) {
  if (!text.includes(from)) throw new Error("Не найдено variants: null");
  text = text.replace(from, to);
  fs.writeFileSync(path, text);
}
console.log("JSON variants исправлен");
