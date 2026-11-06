import test from "node:test";
import assert from "node:assert/strict";
import { extractSkinosophyTablePage, isSkinosophyTable } from "./pdf-skinosophy";
import type { PdfTextFragment } from "./pdf-supplier";
const f = (text: string, x: number, y: number): PdfTextFragment => ({ text, x, y });
const row = (sku: string, y: number, title = "Тестовый продукт") => [
  f(sku, 42, y), f(title, 90, y - 4), f("вторая строка", 90, y + 5),
  f("Подтверждённый компонент", 232, y), f("50 мл", 385, y),
  f("1 200", 460, y), f("2 400", 550, y),
];
test("detects the supplier by headers and content, without relying on filename", () => {
  assert.equal(isSkinosophyTable([f("skinosophy Артикул Наименование Цена косметолог МРЦ", 0, 0)]), true);
  assert.equal(isSkinosophyTable([f("Артикул Наименование Цена", 0, 0)]), false);
});
test("extracts multiline names, original SKU suffixes and two unassigned amounts", () => {
  const [item] = extractSkinosophyTablePage(row("SKY999/1", 100), 2, 595);
  assert.equal(item["Артикул"], "SKY999/1");
  assert.equal(item["Наименование"], "Тестовый продукт вторая строка");
  assert.equal(item["Цена 1"], "1200");
  assert.equal(item["Цена 2"], "2400");
  assert.equal(item["Описание"], "");
  assert.equal(item["Страница"], "2");
});
test("never fills a missing price using the next row or unrelated numeric text", () => {
  const first = row("SKY998", 100).filter(x => x.x !== 550);
  const rows = extractSkinosophyTablePage([...first, ...row("SKY999", 130), f("3000", 550, 108)], 1, 595);
  assert.deepEqual(rows.map(x => x["Артикул"]), ["SKY998", "SKY999"]);
  assert.equal(rows[0]["Цена 2"], "");
  assert.equal(rows[1]["Цена 2"], "2400");
});
test("a name spanning three table rows belongs to all three exact SKUs and their own prices", () => {
  const fragments = [...row("SKY901", 80), ...row("SKY902", 100), ...row("SKY903", 120), ...row("SKY904", 155, "Другой продукт")]
    .filter(f => !(f.x >= 86 && f.x < 230) || (f.y > 90 && f.y < 110) || f.y > 140);
  const rows = extractSkinosophyTablePage(fragments, 1, 595, [60, 135, 180]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0]["Наименование"], rows[1]["Наименование"]);
  assert.equal(rows[2]["Наименование"], rows[1]["Наименование"]);
  assert.match(rows[3]["Наименование"], /Другой продукт/);
});
