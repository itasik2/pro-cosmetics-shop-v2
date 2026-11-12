import type { PdfSupplierRow, PdfTextFragment } from "./pdf-supplier";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const skuPattern = /^SKY\d{2,6}(?:\/\d{1,3})?$/i;

export function isSkinosophyTable(fragments: PdfTextFragment[]): boolean {
  const text = clean(fragments.map(f => f.text).join(" ")).toLowerCase();
  return text.includes("skinosophy") && /артикул/.test(text) && /наименование/.test(text)
    && /косметолог/.test(text) && /мрц/.test(text);
}

export function skinosophySkuCount(fragments: PdfTextFragment[], width: number): number {
  return fragments.filter(f => f.x < width * 0.145 && skuPattern.test(f.text.trim())).length;
}

/** SKU and both price cells anchor each row. Never borrow a neighbouring price. */
export function extractSkinosophyTablePage(
  fragments: PdfTextFragment[], page: number, width: number, titleRules: number[] = [],
): Array<PdfSupplierRow & { "Бренд": string; "Активные ингредиенты": string }> {
  const anchors = fragments.filter(f => f.x < width * 0.145 && skuPattern.test(f.text.trim()))
    .sort((a, b) => a.y - b.y);
  const result: Array<PdfSupplierRow & { "Бренд": string; "Активные ингредиенты": string }> = [];
  for (const [i, anchor] of anchors.entries()) {
    const before = Math.max(anchor.y - 45, i ? (anchors[i - 1].y + anchor.y) / 2 : -Infinity);
    const after = Math.min(anchor.y + 45, i + 1 < anchors.length ? (anchor.y + anchors[i + 1].y) / 2 : Infinity);
    const titleBefore = titleRules.filter(y => y < anchor.y).at(-1) ?? before;
    const titleAfter = titleRules.find(y => y > anchor.y) ?? after;
    const cell = (left: number, right: number, price = false, shared = false) => clean(fragments
      .filter(f => f.x >= width * left && f.x < width * right &&
        (price ? Math.abs(f.y - anchor.y) < 3 :
          f.y > (shared ? titleBefore : before) && f.y < (shared ? titleAfter : after)))
      .sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y)
      .map(f => f.text).join(" "));
    const title = cell(0.145, 0.386, false, true);
    const volume = cell(0.63, 0.745);
    const first = cell(0.745, 0.89, true), second = cell(0.89, 1, true);
    const amount = (v: string) => /^\d[\d\s\u00a0\u202f]*$/.test(v) &&
      /^\d{1,8}$/.test(v.replace(/\s/g, "")) ? v.replace(/\s/g, "") : "";
    const price1 = amount(first) || first, price2 = amount(second) || second;
    // An empty/prohibited commercial amount is an import validation issue,
    // not a reason to hide the supplier's SKU from the preview.
    if (!title) continue;
    result.push({
      "Артикул": anchor.text.trim().toUpperCase(), "Наименование": title,
      "Описание": "", "Активные ингредиенты": cell(0.386, 0.63, false, true),
      "Объем": volume, "Цена 1": price1, "Цена 2": price2,
      "Страница": String(page), "Бренд": "Skinosophy",
    });
  }
  return result;
}
