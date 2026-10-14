import test from "node:test";
import assert from "node:assert/strict";
import { extractAngiopharmTablePage } from "./pdf-angiopharm";
import type { PdfTextFragment } from "./pdf-supplier";

function fragment(text: string, x: number, y: number): PdfTextFragment { return { text, x, y }; }

test("reads table prices, supplier codes and separate package variants without treating headers as products", () => {
  const rows = extractAngiopharmTablePage([
    fragment("Наименование", 40, 85), fragment("Объём, мл.", 450, 85), fragment("Цена, тг.", 520, 85),
    fragment("Легкое гидрофильное масло CL01", 30, 122), fragment("100", 448, 122), fragment("10 200", 520, 122),
    fragment("Легкое гидрофильное масло CL22", 30, 141), fragment("200", 448, 141), fragment("17 000", 520, 141),
    fragment("Стикеры в ассортименте", 30, 160), fragment("1 шт.", 448, 160), fragment("300", 520, 160),
  ], 1, 595);
  assert.deepEqual(rows.map(row => [row["Артикул"], row["Наименование"], row["Объем"], row["Цена 1"]]), [
    ["CL01", "Легкое гидрофильное масло (100 мл)", "100 мл", "10200"],
    ["CL22", "Легкое гидрофильное масло (200 мл)", "200 мл", "17000"],
    ["", "Стикеры в ассортименте (1 шт.)", "1 шт.", "300"],
  ]);
  assert.ok(rows.every(row => row["Цена 2"] === "" && row["Бренд"] === "ANGIOPHARM"));
});
