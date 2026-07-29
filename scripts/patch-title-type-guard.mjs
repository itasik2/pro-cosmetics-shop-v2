import { readFile, writeFile } from "node:fs/promises";

const path = "lib/enrichment/extractProduct.ts";
let content = await readFile(path, "utf8");
const search = "function isLikelyProductTitle(value: string | null) {";
const replacement = "function isLikelyProductTitle(value: string | null): value is string {";
if (!content.includes(search)) throw new Error("Не найдена функция isLikelyProductTitle");
content = content.replace(search, replacement);
await writeFile(path, content);
