import type { PdfSupplierRow, PdfTextFragment } from "./pdf-supplier";

type Line = { y: number; parts: PdfTextFragment[] };
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const skuPattern = /\b([A-Z]{2,4}\d{2})\s*$/i;

/** The supplier's table has separate name, pack size and price columns. */
export function extractAngiopharmTablePage(
  fragments: PdfTextFragment[], pageNo: number, width: number,
): Array<PdfSupplierRow & { "Бренд": string }> {
  const lines: Line[] = [];
  for (const fragment of [...fragments].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - fragment.y) <= 2.4) {
      last.parts.push(fragment);
      last.y += (fragment.y - last.y) / last.parts.length;
    } else lines.push({ y: fragment.y, parts: [fragment] });
  }
  const rows: Array<PdfSupplierRow & { "Бренд": string }> = [];
  for (const line of lines) {
    const parts = line.parts.sort((a, b) => a.x - b.x);
    const column = (from: number, to: number) =>
      clean(parts.filter(part => part.x >= from && part.x < to).map(part => part.text).join(" "));
    const title = column(0, width * 0.72);
    const pack = column(width * 0.72, width * 0.84);
    const rawPrice = column(width * 0.84, Infinity);
    if (!title || !/^\d[\d\s\u00a0\u202f]*$/.test(rawPrice) ||
        !/^\d{3,8}$/.test(rawPrice.replace(/\D/g, ""))) continue;
    const sku = title.match(skuPattern)?.[1]?.toUpperCase() || "";
    const name = clean(sku ? title.replace(skuPattern, "") : title);
    if (name.length < 4 || /^\d/.test(name)) continue;
    // The pack column is numeric in most rows and is labelled "мл" in the
    // table header. Explicit g/шт/уп values keep their own units.
    const volume = /^\d{1,4}(?:[.,]\d+)?$/.test(pack) ? pack + " мл" :
      /^\d{1,4}(?:[.,]\d+)?\s*(?:мл|г|шт\.?|уп\.?|рулон\w*)$/iu.test(pack) ? pack : "";
    const variant = volume && !name.toLowerCase().includes(volume.toLowerCase())
      ? name + " (" + volume + ")" : name;
    rows.push({
      "Артикул": sku, "Наименование": variant, "Описание": "", "Объем": volume,
      "Цена 1": rawPrice.replace(/\D/g, ""), "Цена 2": "", "Страница": String(pageNo),
      "Бренд": "ANGIOPHARM",
    });
  }
  return rows;
}
