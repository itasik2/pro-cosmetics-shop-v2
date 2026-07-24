import { createHash } from "node:crypto";
import type { ParsedPriceRow, PriceParseResult, PriceVolumeUnit } from "./types";

type PdfItem = { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
type Item = { text: string; x: number; top: number; width: number; height: number };
type Line = { top: number; items: Item[] };
type Anchor = {
  top: number;
  sourcePrice: number;
  recommendedPrice: number | null;
  clientText: string;
};
type NameGroup = { lines: Line[]; start: number; end: number };

const MAX_PAGES = 30;
const LINE_TOLERANCE = 2.8;
const NAME_GAP = 14.2;
const DATE_RE = /\b([0-3]\d)[./-]([01]\d)[./-](20\d{2})\b/;

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function number(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function isPdfItem(item: PdfItem): item is PdfItem & { str: string; transform: number[] } {
  return typeof item?.str === "string" && Array.isArray(item.transform) && item.transform.length >= 6;
}

function groupLines(items: Item[]) {
  const lines: Line[] = [];
  for (const item of [...items].sort((a, b) => a.top - b.top || a.x - b.x)) {
    const line = lines.slice(-4).find((candidate) => Math.abs(candidate.top - item.top) <= LINE_TOLERANCE);
    if (line) {
      line.items.push(item);
      line.top = (line.top * (line.items.length - 1) + item.top) / line.items.length;
    } else {
      lines.push({ top: item.top, items: [item] });
    }
  }
  return lines
    .sort((a, b) => a.top - b.top)
    .map((line) => ({ ...line, items: line.items.sort((a, b) => a.x - b.x) }));
}

function joinItems(items: Item[], separator = " ") {
  return items.map((item) => item.text).filter(Boolean).join(separator).replace(/\s+/g, " ").trim();
}

function joinLines(lines: Line[]) {
  return lines.map((line) => joinItems(line.items)).filter(Boolean).join("\n").trim();
}

function column(line: Line, start: number, end: number) {
  return joinItems(line.items.filter((item) => item.x >= start && item.x < end));
}

function parsePrice(value: string) {
  const digits = value.replace(/(?:₸|тг\.?|kzt)/giu, "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const result = Number(digits);
  return Number.isInteger(result) && result >= 100 ? result : null;
}

function parseDate(value: string) {
  const match = value.match(DATE_RE);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function volume(value: string): { value: number | null; unit: PriceVolumeUnit; label: string } {
  const label = clean(value);
  const normalized = normalize(label);
  const match = normalized.match(/\d+(?:[.,]\d+)?/);
  const count = match ? Math.max(0, Math.round(Number(match[0].replace(",", ".")))) : null;

  if (/ампул|флакон|набор|комплект|упак/.test(normalized)) return { value: count ?? 1, unit: "pack", label };
  if (/рулон/.test(normalized)) return { value: count ?? 1, unit: "roll", label };
  if (/шт|ед\.?/.test(normalized)) return { value: count ?? 1, unit: "pcs", label };
  if (/(?:кг|килограмм)/.test(normalized)) return { value: count === null ? null : count * 1000, unit: "g", label };
  if (/(?:гр\.?|\bг\b|грамм)/.test(normalized)) return { value: count, unit: "g", label };
  if (/(?:мл|миллилитр)/.test(normalized)) return { value: count, unit: "ml", label };
  return { value: count, unit: null, label };
}

function hasVolume(value: string) {
  return /(?:мл|гр\.?|\bг\b|ампул|флакон|шт|упак|набор|комплект)/iu.test(value);
}

function header(value: string) {
  const text = normalize(value);
  return (
    text.includes("наименование") ||
    text.includes("описание") ||
    text.includes("ваша цена") ||
    text.includes("клиент") ||
    text === "объем" ||
    text === "объём"
  );
}

function category(value: string) {
  const text = normalize(value);
  return (
    /^профессиональный уход/u.test(text) ||
    /^эксперт-гели/u.test(text) ||
    /^spf\s*\|/u.test(text) ||
    /^(?:anti acne|anti age|sensi plus|aqua expert)\s*\|/u.test(text) ||
    /^мультикислотные пилинги$/u.test(text) ||
    /^аксессуары$/u.test(text)
  );
}

function categoryName(value: string) {
  return clean(value.replace(/^.*?\|\s*/, "")) || "Mesaltera";
}

function anchors(lines: Line[], width: number) {
  const volumeStart = width * 0.65;
  const sourceStart = width * 0.783;
  const clientStart = width * 0.871;

  return lines
    .map((line): Anchor | null => {
      const sourcePrice = parsePrice(column(line, sourceStart, clientStart));
      if (!sourcePrice) return null;
      const nearbyVolume = lines
        .filter((candidate) => Math.abs(candidate.top - line.top) <= 22)
        .map((candidate) => column(candidate, volumeStart, sourceStart))
        .filter(Boolean)
        .join(" ");
      if (!hasVolume(nearbyVolume)) return null;
      const clientText = column(line, clientStart, width + 1);
      return { top: line.top, sourcePrice, recommendedPrice: parsePrice(clientText), clientText };
    })
    .filter((entry): entry is Anchor => Boolean(entry))
    .sort((a, b) => a.top - b.top);
}

function nameGroups(lines: Line[], nameEnd: number, maxTop: number): NameGroup[] {
  const source = lines.filter((line) => {
    if (line.top >= maxTop) return false;
    const text = joinItems(line.items.filter((item) => item.x < nameEnd));
    return Boolean(text) && !header(text);
  });
  const groups: Line[][] = [];
  for (const line of source) {
    const previous = groups.at(-1)?.at(-1);
    if (previous && line.top - previous.top <= NAME_GAP) groups.at(-1)!.push(line);
    else groups.push([line]);
  }

  return groups.map((group, index) => {
    const previous = groups[index - 1];
    const next = groups[index + 1];
    const first = group[0].top;
    const last = group.at(-1)!.top;
    return {
      lines: group,
      start: previous ? (previous.at(-1)!.top + first) / 2 : Math.max(0, first - 24),
      end: next ? (last + next[0].top) / 2 : maxTop,
    };
  });
}

function volumeFor(lines: Line[], list: Anchor[], index: number, start: number, end: number, width: number) {
  const anchor = list[index];
  const previous = list[index - 1];
  const next = list[index + 1];
  const low = Math.max(start, previous ? (previous.top + anchor.top) / 2 : anchor.top - 24);
  const high = Math.min(end, next ? (anchor.top + next.top) / 2 : anchor.top + 24);
  return lines
    .filter((line) => line.top >= low && line.top < high)
    .map((line) => column(line, width * 0.65, width * 0.783))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function sku(input: { name: string; volumeLabel: string; sourcePrice: number; description: string }) {
  const fingerprint = normalize(
    `${input.name}|${input.volumeLabel}|${input.sourcePrice}|${input.description.slice(0, 120)}`,
  );
  return `MESA-${createHash("sha1").update(fingerprint).digest("hex").slice(0, 12).toUpperCase()}`;
}

function makeRow(input: {
  pageNumber: number;
  rowNumber: number;
  name: string;
  description: string;
  volumeLabel: string;
  sourcePrice: number;
  recommendedPrice: number | null;
  clientText: string;
  category: string;
  sourceDate: string | null;
}): ParsedPriceRow {
  const parsedVolume = volume(input.volumeLabel);
  const warnings = ["synthetic_sku_generated"];
  if (!input.description) warnings.push("description_not_found");
  if (!parsedVolume.label) warnings.push("volume_not_found");
  if (!input.recommendedPrice) warnings.push("recommended_price_not_available");
  if (/запрет/iu.test(input.clientText)) warnings.push("retail_sale_restricted");

  let confidence = 50;
  if (input.description.length >= 20) confidence += 20;
  if (parsedVolume.label) confidence += 15;
  if (input.recommendedPrice) confidence += 10;
  if (input.category !== "Mesaltera") confidence += 5;

  return {
    pageNumber: input.pageNumber,
    rowNumber: input.rowNumber,
    brand: "MESALTERA",
    supplierSku: sku(input),
    originalName: input.name,
    normalizedName: input.name,
    description: input.description || null,
    volumeValue: parsedVolume.value,
    volumeUnit: parsedVolume.unit,
    volumeLabel: parsedVolume.label,
    sourcePrice: input.sourcePrice,
    recommendedPrice: input.recommendedPrice,
    productLineCode: null,
    productLineName: input.category,
    category: input.category,
    sourceDate: input.sourceDate,
    confidence: Math.min(100, confidence),
    warnings,
  };
}

export async function parseMesalteraPdf(bytes: Uint8Array): Promise<PriceParseResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: bytes, useSystemFonts: true, verbosity: 0 });
  const document = await loadingTask.promise;
  if (document.numPages > MAX_PAGES) throw new Error(`pdf_too_many_pages:${document.numPages}`);

  const rows: ParsedPriceRow[] = [];
  const warnings: string[] = [];
  let sourceDate: string | null = null;
  let currentCategory = "Mesaltera";
  let rowNumber = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of textContent.items as PdfItem[]) {
      if (!isPdfItem(raw)) continue;
      const text = clean(raw.str);
      if (!text) continue;
      items.push({
        text,
        x: number(raw.transform[4]),
        top: viewport.height - number(raw.transform[5]),
        width: number(raw.width),
        height: number(raw.height),
      });
    }

    const lines = groupLines(items);
    sourceDate = sourceDate || parseDate(lines.map((line) => joinItems(line.items)).join(" "));
    const categoryRows = lines
      .map((line) => ({ top: line.top, text: joinItems(line.items) }))
      .filter((entry) => category(entry.text));
    const accessoryRow = categoryRows.find((entry) => /^аксессуары$/u.test(normalize(entry.text)));
    const accessoryStart = accessoryRow?.top ?? viewport.height + 1;
    const priceRows = anchors(lines, viewport.width);
    const groups = nameGroups(lines, viewport.width * 0.225, accessoryStart);

    const categoryAt = (top: number) => {
      const found = categoryRows.filter((entry) => entry.top < top).at(-1);
      if (found) currentCategory = categoryName(found.text);
      return currentCategory;
    };

    for (const group of groups) {
      const groupAnchors = priceRows.filter((entry) => entry.top >= group.start && entry.top < group.end);
      if (!groupAnchors.length) continue;
      const name = joinLines(
        group.lines.map((line) => ({
          ...line,
          items: line.items.filter((item) => item.x < viewport.width * 0.225),
        })),
      ).replace(/\n/g, " ");
      if (!name || header(name)) continue;
      const description = joinLines(
        lines
          .filter((line) => line.top >= group.start && line.top < group.end)
          .map((line) => ({
            ...line,
            items: line.items.filter(
              (item) => item.x >= viewport.width * 0.225 && item.x < viewport.width * 0.65,
            ),
          }))
          .filter((line) => line.items.length > 0),
      );
      const productCategory = categoryAt(group.lines[0].top);

      for (let index = 0; index < groupAnchors.length; index += 1) {
        const anchor = groupAnchors[index];
        rowNumber += 1;
        rows.push(
          makeRow({
            pageNumber,
            rowNumber,
            name,
            description,
            volumeLabel: volumeFor(lines, groupAnchors, index, group.start, group.end, viewport.width),
            sourcePrice: anchor.sourcePrice,
            recommendedPrice: anchor.recommendedPrice,
            clientText: anchor.clientText,
            category: productCategory,
            sourceDate,
          }),
        );
      }
    }

    if (accessoryRow) {
      currentCategory = "Аксессуары";
      const accessoryAnchors = priceRows.filter((entry) => entry.top > accessoryRow.top);
      for (let index = 0; index < accessoryAnchors.length; index += 1) {
        const anchor = accessoryAnchors[index];
        const previous = accessoryAnchors[index - 1];
        const next = accessoryAnchors[index + 1];
        const start = previous ? (previous.top + anchor.top) / 2 : anchor.top - 8;
        const end = next ? (anchor.top + next.top) / 2 : anchor.top + 8;
        const name = joinLines(
          lines
            .filter((line) => line.top >= start && line.top < end)
            .map((line) => ({
              ...line,
              items: line.items.filter((item) => item.x < viewport.width * 0.225),
            }))
            .filter((line) => line.items.length > 0),
        ).replace(/\n/g, " ");
        if (!name) continue;
        const description = joinLines(
          lines
            .filter((line) => line.top >= start && line.top < end)
            .map((line) => ({
              ...line,
              items: line.items.filter(
                (item) => item.x >= viewport.width * 0.225 && item.x < viewport.width * 0.65,
              ),
            }))
            .filter((line) => line.items.length > 0),
        );
        rowNumber += 1;
        rows.push(
          makeRow({
            pageNumber,
            rowNumber,
            name,
            description,
            volumeLabel: volumeFor(lines, accessoryAnchors, index, start, end, viewport.width),
            sourcePrice: anchor.sourcePrice,
            recommendedPrice: anchor.recommendedPrice,
            clientText: anchor.clientText,
            category: currentCategory,
            sourceDate,
          }),
        );
      }
    }

    const lastCategory = categoryRows.at(-1);
    if (lastCategory) currentCategory = categoryName(lastCategory.text);
  }

  if (!rows.length) throw new Error("no_price_rows_found");
  if (!sourceDate) warnings.push("source_date_not_found");
  const restricted = rows.filter((row) => row.warnings.includes("retail_sale_restricted")).length;
  if (restricted) warnings.push(`retail_sale_restricted:${restricted}`);

  return {
    parserId: "MESALTERA_PDF",
    sourceDate,
    pageCount: document.numPages,
    rows,
    warnings,
  };
}
