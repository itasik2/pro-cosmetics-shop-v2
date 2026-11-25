import { createHash } from "node:crypto";
import type { PdfTableItem, PdfTablePage } from "./pdfTableGeometry";
import type { ParsedPriceRow, PriceParseResult } from "./types";

// The supplier's PDF export uses different broken text maps for the bold
// product name and the regular subtitle; the printed glyphs are Cyrillic.
const BOLD = { "0": "о", "1": "т", "2": "р", "3": "ь", "4": "К", "5": "ж", "6": "М", "7": "г", "8": "й", "9": "п", "%": "а", ",": "в", "-": "и", "/": "б", F: "Т", O: "У", P: "О" };
const REGULAR = { "0": "с", "1": "у", "2": "х", "3": "а", "4": "ь", "5": "А", "7": "ы", "+": "ж" };

function damagedFont(items: PdfTableItem[], marker: RegExp) {
  return items.find((item) => marker.test(item.text))?.fontName;
}

function baseline(item: PdfTableItem) {
  return item.top - item.height / 2;
}

function joinName(items: PdfTableItem[], bold: string | undefined, regular: string | undefined) {
  return items.sort((a, b) => Math.abs(a.top - b.top) < 2 ? a.x - b.x : a.top - b.top)
    .map((item) => {
      const map: Record<string, string> | undefined = !item.fontName ? undefined
        : item.fontName === bold ? BOLD : item.fontName === regular ? REGULAR : undefined;
      return map ? [...item.text].map((character) => map[character] ?? character).join("") : item.text;
    })
    .join(" ").replace(/«\s+/gu, "«").replace(/\s+([,»:])/gu, "$1")
    .replace(/\s+-\s+/gu, "-").replace(/\s+/gu, " ").trim();
}

function horizontalBounds(page: PdfTablePage, x: number, y: number) {
  const rules = page.horizontal.filter((r) => r.x1 < x && r.x2 > x);
  const top = Math.max(...rules.filter((r) => r.top < y).map((r) => r.top));
  const bottom = Math.min(...rules.filter((r) => r.top > y).map((r) => r.top));
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) throw new Error("pdf_table_row_incomplete");
  return { top, bottom };
}

export function parseTekomPages(pages: PdfTablePage[]): PriceParseResult | null {
  const allItems = pages.flatMap((page) => page.items);
  if (!allItems.some((item) => /(?:sale@tekom\.kz|tekom\.360)/iu.test(item.text)) ||
      !allItems.some((item) => /m\.aklive/iu.test(item.text))) return null;
  const headers = pages.map((page) => {
    const volume = page.items.find((i) => /^объ[её]м$/iu.test(i.text));
    const wholesale = page.items.find((i) => /^косметолог$/iu.test(i.text));
    const retail = page.items.find((i) => /^ррц$/iu.test(i.text));
    return volume && wholesale && retail ? [volume, wholesale, retail] as const : null;
  });
  if (headers.every((header) => header === null)) return null;

  const bold = damagedFont(allItems, /к0н120л3|у,л%5няющ|6ул31-к-сл01/u);
  const regular = damagedFont(allItems, /Во00т3новление|Делик3тн7й/u);
  const rows: ParsedPriceRow[] = [];
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const header = headers[index];
    if (!header) throw new Error("pdf_table_layout_changed");

    const centers = header.map((item) => item.x + item.width / 2);
    const step = centers[2] - centers[1];
    if (step <= 20 || Math.abs(centers[1] - centers[0] - step) > 5)
      throw new Error("pdf_table_layout_changed");
    const [volumeX, wholesaleX, retailX] = centers;
    const inColumn = (item: PdfTableItem, x: number) =>
      Math.abs(item.x + item.width / 2 - x) < step / 2 - 2;
    const nameX = volumeX - step;
    const headerEnd = Math.max(...header.map((i) => i.top));
    const professional = page.items.find((i) => /^PROFMED$/iu.test(i.text));
    const volumeItems = page.items.filter((i) =>
      i.top > headerEnd && inColumn(i, volumeX) && /^(?:\d+\s*)?(?:мл|г|гр\.?)$/iu.test(i.text))
      .sort((a, b) => a.top - b.top);
    const nameItems = page.items.filter((i) => i.x < volumeX - step / 2 &&
      i.top > headerEnd && !/^(?:NEW|[\uE000-\uF8FF]+)$/iu.test(i.text));
    if (!volumeItems.length) throw new Error("pdf_table_row_incomplete");
    for (const item of volumeItems) {
      const y = baseline(item);
      const { top, bottom } = horizontalBounds(page, nameX, y);
      const name = joinName(nameItems.filter((i) => baseline(i) > top && baseline(i) < bottom), bold, regular);
      const cell = (x: number) => page.items.filter((i) =>
        inColumn(i, x) && Math.abs(baseline(i) - y) < 2).sort((a, b) => a.x - b.x)
        .map((i) => i.text).join(" ").trim();
      const volume = cell(volumeX).match(/^(\d{1,4})\s*(мл|г|гр\.?)$/iu);
      const source = cell(wholesaleX).replace(/\s/g, "");
      const recommended = cell(retailX).replace(/\s/g, "");
      const restricted = Boolean(professional && y > professional.top);
      if (!volume || !/^\d{1,8}$/.test(source) || Number(source) <= 0 ||
          (restricted ? !/^[-–—]$/.test(recommended) : !/^\d{1,8}$/.test(recommended) || Number(recommended) < Number(source)) ||
          (name.match(/\p{L}/gu)?.length ?? 0) < 4 || /[\uE000-\uF8FF]|\p{L}\d+\p{L}|(?:^|\s)\d+\p{L}/u.test(name))
        throw new Error("pdf_table_row_incomplete");
      const volumeValue = Number(volume[1]);
      const volumeUnit = volume[2].toLowerCase() === "мл" ? "ml" : "g";
      const volumeLabel = `${volumeValue} ${volumeUnit === "ml" ? "мл" : "г"}`;
      const sku = createHash("sha256").update(`m.aklive::${name.toLowerCase()}::${volumeLabel}`)
        .digest("hex").slice(0, 12).toUpperCase();
      rows.push({
        pageNumber: page.pageNumber, rowNumber: rows.length + 1, brand: "M.AKLIVE",
        supplierSku: "INT-PRICE-" + sku, originalName: name, normalizedName: name,
        volumeValue, volumeUnit, volumeLabel, sourcePrice: Number(source),
        recommendedPrice: restricted ? null : Number(recommended),
        productLineCode: restricted ? "PROFMED" : null,
        productLineName: restricted ? "PROFMED" : null,
        category: restricted ? "Пилинги" : "Без категории",
        sourceDate: null, confidence: 95,
        warnings: restricted ? ["synthetic_sku_generated", "retail_sale_restricted"] : ["synthetic_sku_generated"],
      });
    }
  }
  if (new Set(rows.map((row) => row.supplierSku)).size !== rows.length)
    throw new Error("pdf_table_sku_invalid");
  return { parserId: "TABLE_PDF", sourceDate: null, pageCount: pages.length, rows, warnings: [] };
}
