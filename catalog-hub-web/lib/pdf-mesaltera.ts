import type { PdfSupplierRow, PdfTextFragment } from "./pdf-supplier";

type Line = { y: number; parts: PdfTextFragment[] };
type Anchor = { y: number; size: string; firstPrice: string; secondPrice: string };
type NameBlock = { start: number; end: number; lines: string[] };

const clean = (text: string) => text.replace(/\s+/gu, " ").trim();

function orderedLines(fragments: PdfTextFragment[]): Line[] {
  const lines: Line[] = [];
  for (const fragment of [...fragments].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - fragment.y) <= 3.1) {
      last.parts.push(fragment);
      last.y += (fragment.y - last.y) / last.parts.length;
    } else lines.push({ y: fragment.y, parts: [fragment] });
  }
  return lines;
}

function column(line: Line, from: number, to: number) {
  return clean(line.parts.filter(part => part.x >= from && part.x < to)
    .sort((a, b) => a.x - b.x).map(part => part.text).join(" "));
}

const packPattern = /^(\d{1,4}(?:[.,]\d+)?)\s*(мл|ml|г|гр|g|л|l|кг|kg|шт|уп|упак)\.?$/iu;
function pack(raw: string): string | null {
  const match = raw.match(packPattern);
  if (!match || Number(match[1].replace(",", ".")) <= 0) return null;
  return match[1] + " " + match[2].toLowerCase();
}
function price(raw: string): string {
  const value = raw.replace(/[\s\u00a0\u202f]/gu, "");
  return /^\d{3,8}$/u.test(value) ? value : "";
}
function chooseName(lines: string[]): string {
  // A mixed-language title normally starts with the original product name
  // and continues with a translated caption. Do not mix both into SKU identity.
  const original: string[] = [];
  const latinFirst = /[\p{Script=Latin}]/u.test(lines[0] || "");
  for (const line of lines) {
    if (latinFirst && /[\p{Script=Cyrillic}]/u.test(line)) break;
    original.push(line);
  }
  return clean((original.length ? original : lines).join(" ")).slice(0,220);
}

/** A table is identified from actual document content, not a filename alone. */
export function isMesalteraTable(fragments: PdfTextFragment[]): boolean {
  const all = clean(fragments.map(fragment => fragment.text).join(" ")).toLowerCase();
  return /mesaltera|месалтер/u.test(all) &&
    /наименование/u.test(all) && /об[ъь]?[её]м/u.test(all) &&
    /клиент/u.test(all) && /цена/u.test(all);
}

/**
 * Count visually present pack cells, including ranges and rows whose prices are
 * marked with words instead of numbers. These are not necessarily importable.
 * Show their count so an incomplete PDF import is never silently accepted.
 */
export function countMesalteraPackCells(
  fragments: PdfTextFragment[], width: number, height: number,
): number {
  return orderedLines(fragments.filter(fragment =>
    fragment.y > height * 0.16 && fragment.y < height * 0.97))
    .filter(line => /^\d[\d\s,.\-–]*\s*(?:мл|ml|г|гр|g|л|l|кг|kg|шт|уп|упак)\.?$/iu
      .test(column(line, width * 0.68, width * 0.78)))
    .length;
}

/**
 * Mesaltera pricebook layout: name | description | pack | your price | client price.
 * A product name may span multiple lines; several price rows may share one name.
 * Never invent supplier SKUs or decide which price is purchase versus retail.
 * Unclear rows are omitted for manual review, not attached to the wrong product.
 */
export function extractMesalteraTablePage(
  fragments: PdfTextFragment[], pageNo: number, width: number, height: number,
): Array<PdfSupplierRow & { "Бренд": string }> {
  const lines = orderedLines(fragments.filter(fragment =>
    fragment.y > height * 0.16 && fragment.y < height * 0.97));
  const anchors: Anchor[] = [];
  for (const line of lines) {
    const size = pack(column(line, width * 0.68, width * 0.78));
    if (!size) continue;
    const firstPrice = price(column(line, width * 0.78, width * 0.88));
    const secondPrice = price(column(line, width * 0.88, Infinity));
    // Both source prices are necessary to consider this a fully parsed row.
    // A missing amount must not be silently interpreted as a zero or guessed.
    if (!firstPrice || !secondPrice) continue;
    anchors.push({ y: line.y, size, firstPrice, secondPrice });
  }
  if (!anchors.length) return [];

  const titleLines = lines.map(line => ({
    y: line.y,
    text: column(line, 0, width * 0.22),
  })).filter(line => line.text && line.text.length >= 3 &&
    !/^(?:наименование|тел\.?|казахстан|контакты|группа компаний)/iu.test(line.text) &&
    !/^\+?\d[\d\s()+-]+$/u.test(line.text));

  // Accessories pages can place a *different* product on every 12–15 pt
  // baseline. Grouping consecutive title lines would merge unrelated items.
  // On dense pages match each verified pack/price anchor only to its own name.
  const denseRows = anchors.length >= 6 && anchors.filter((entry, index) =>
    index > 0 && entry.y - anchors[index - 1].y <= 22).length >= 4;
  const makeRow = (anchor: Anchor, name: string): PdfSupplierRow & { "Бренд": string } => ({
    "Артикул": "",
    "Наименование": name + " (" + anchor.size + ")",
    "Описание": "",
    "Объем": anchor.size,
    "Цена 1": anchor.firstPrice,
    "Цена 2": anchor.secondPrice,
    "Страница": String(pageNo),
    "Бренд": "MESALTERA",
  });
  if (denseRows) {
    const rows: Array<PdfSupplierRow & { "Бренд": string }> = [];
    for (const anchor of anchors) {
      const name = [...titleLines]
        .sort((a, b) => Math.abs(a.y - anchor.y) - Math.abs(b.y - anchor.y))[0];
      if (!name || Math.abs(name.y - anchor.y) > 9) continue;
      rows.push(makeRow(anchor, clean(name.text).slice(0, 220)));
    }
    return rows;
  }

  const blocks: NameBlock[] = [];
  for (const line of titleLines) {
    const last = blocks.at(-1);
    if (last && line.y - last.end <= 17) {
      last.end = line.y;
      last.lines.push(line.text);
    } else blocks.push({ start: line.y, end: line.y, lines: [line.text] });
  }

  const assigned = new Map<number, { name: string; distance: number }>();
  for (const block of blocks) {
    const name = chooseName(block.lines);
    if (name.length < 4) continue;
    // Supplier cards can show the first pack/price *above* the title.
    // Associate the product from the first line of its name, not the
    // midpoint of the full multilingual caption. Midpoint matching can
    // incorrectly attach the next product's first price to the previous one.
    const anchorY = block.start;
    let nearest = -1, distance = Infinity;
    anchors.forEach((anchor, index) => {
      const d = Math.abs(anchor.y - anchorY);
      if (d < distance) { nearest = index; distance = d; }
    });
    if (nearest < 0 || distance > 40) continue;
    const prev = assigned.get(nearest);
    if (!prev || distance < prev.distance) assigned.set(nearest, { name, distance });
  }

  const rows: Array<PdfSupplierRow & { "Бренд": string }> = [];
  let lastName = "", lastAnchorY = -Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const explicit = assigned.get(i)?.name;
    const name = explicit || (anchor.y - lastAnchorY <= 80 ? lastName : "");
    if (!name) continue;
    if (explicit) lastName = explicit;
    lastAnchorY = anchor.y;
    rows.push(makeRow(anchor, name));
  }
  return rows;
}
