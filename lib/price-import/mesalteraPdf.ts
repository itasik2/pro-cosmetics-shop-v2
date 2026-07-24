import { createHash } from "node:crypto";
import type { ParsedPriceRow, PriceParseResult, PriceVolumeUnit } from "./types";

type PdfTextItem = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
};

type PositionedText = {
  text: string;
  x: number;
  top: number;
  width: number;
  height: number;
};

type PositionedLine = {
  top: number;
  items: PositionedText[];
};

type PriceAnchor = {
  top: number;
  sourcePrice: number;
  recommendedPrice: number | null;
  clientPriceText: string;
};

type NameBlock = {
  start: number;
  end: number;
  lines: PositionedLine[];
};

const MAX_PAGES = 30;
const LINE_TOLERANCE = 2.8;
const NAME_LINE_GAP = 14.2;
const DATE_RE = /\b([0-3]\d)[./-]([01]\d)[./-](20\d{2})\b/;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function isPdfTextItem(item: PdfTextItem): item is PdfTextItem & {
  str: string;
  transform: number[];
} {
  return (
    typeof item?.str === "string" &&
    Array.isArray(item?.transform) &&
    item.transform.length >= 6
  );
}

function groupLines(items: PositionedText[]): PositionedLine[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);
  const lines: PositionedLine[] = [];

  for (const item of sorted) {
    const closest = lines
      .slice(-4)
      .find((line) => Math.abs(line.top - item.top) <= LINE_TOLERANCE);

    if (closest) {
      closest.items.push(item);
      closest.top =
        (closest.top * (closest.items.length - 1) + item.top) /
        closest.items.length;
    } else {
      lines.push({ top: item.top, items: [item] });
    }
  }

  return lines
    .sort((a, b) => a.top - b.top)
    .map((line) => ({
      top: line.top,
      items: line.items.sort((a, b) => a.x - b.x),
    }));
}

function joinItems(items: PositionedText[], separator = " ") {
  return items
    .map((item) => item.text)
    .filter(Boolean)
    .join(separator)
    .replace(/\s+/g, " ")
    .trim();
}

function joinLines(lines: PositionedLine[]) {
  return lines
    .map((line) => joinItems(line.items))
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDate(text: string) {
  const match = text.match(DATE_RE);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function parsePrice(value: string) {
  const normalized = value
    .replace(/(?:₸|тг\.?|kzt)/giu, "")
    .replace(/\s+/g, "")
    .replace(/[^\d]/g, "");
  if (!normalized) return null;

  const price = Number(normalized);
  if (!Number.isInteger(price) || price < 100) return null;
  return price;
}

function parseVolume(value: string): {
  value: number | null;
  unit: PriceVolumeUnit;
  label: string;
} {
  const label = cleanText(value);
  const normalized = normalizeText(label);
  const numberMatch = normalized.match(/\d+(?:[.,]\d+)?/);
  const numericValue = numberMatch
    ? Math.max(0, Math.round(Number(numberMatch[0].replace(",", "."))))
    : null;

  if (/ампул|флакон|набор|комплект|упак/.test(normalized)) {
    return { value: numericValue ?? 1, unit: "pack", label };
  }
  if (/рулон/.test(normalized)) {
    return { value: numericValue ?? 1, unit: "roll", label };
  }
  if (/шт|ед\.?/.test(normalized)) {
    return { value: numericValue ?? 1, unit: "pcs", label };
  }
  if (/(?:кг|килограмм)/.test(normalized)) {
    return {
      value: numericValue === null ? null : numericValue * 1000,
      unit: "g",
      label,
    };
  }
  if (/(?:гр\.?|\bг\b|грамм)/.test(normalized)) {
    return { value: numericValue, unit: "g", label };
  }
  if (/(?:мл|миллилитр)/.test(normalized)) {
    return { value: numericValue, unit: "ml", label };
  }

  return { value: numericValue, unit: null, label };
}

function looksLikeVolume(value: string) {
  return /(?:мл|гр\.?|\bг\b|ампул|флакон|шт|упак|набор|комплект)/iu.test(
    value,
  );
}

function isHeader(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("наименование") ||
    normalized.includes("описание") ||
    normalized.includes("ваша цена") ||
    normalized.includes("клиент") ||
    normalized === "объем" ||
    normalized === "объём"
  );
}

function isCategoryText(text: string) {
  const normalized = normalizeText(text);
  if (!normalized || isHeader(normalized)) return false;
  if (normalized.length > 120) return false;

  return (
    normalized.includes("|") ||
    /(?:профессиональн|эксперт-гели|солнцезащит|уход за|омолаживающ|чувствительн|пилинг|аксессуар)/u.test(
      normalized,
    )
  );
}

function categoryLabel(value: string) {
  return cleanText(value.replace(/^.*?\|\s*/, "")) || "Mesaltera";
}

function syntheticSku(name: string, volumeLabel: string) {
  const fingerprint = normalizeText(`${name}|${volumeLabel}`);
  const digest = createHash("sha1").update(fingerprint).digest("hex").slice(0, 12);
  return `MESA-${digest.toUpperCase()}`;
}

function calculateConfidence(input: {
  name: string;
  description: string;
  volumeLabel: string;
  sourcePrice: number;
  recommendedPrice: number | null;
  category: string;
}) {
  let confidence = 0;
  if (input.name.length >= 3) confidence += 25;
  if (input.description.length >= 20) confidence += 20;
  if (input.volumeLabel) confidence += 15;
  if (input.sourcePrice > 0) confidence += 20;
  if (input.recommendedPrice && input.recommendedPrice > 0) confidence += 10;
  if (input.category && input.category !== "Mesaltera") confidence += 5;
  confidence += 5; // стабильный служебный SKU
  return Math.min(100, confidence);
}

function nameBlocks(lines: PositionedLine[], nameEnd: number, maxTop: number) {
  const nameLines = lines.filter((line) => {
    if (line.top >= maxTop) return false;
    const text = joinItems(line.items.filter((item) => item.x < nameEnd));
    if (!text || isHeader(text)) return false;
    return line.items.some((item) => item.x < nameEnd);
  });

  const groups: PositionedLine[][] = [];
  for (const line of nameLines) {
    const lastGroup = groups.at(-1);
    const previous = lastGroup?.at(-1);
    if (lastGroup && previous && line.top - previous.top <= NAME_LINE_GAP) {
      lastGroup.push(line);
    } else {
      groups.push([line]);
    }
  }

  return groups.map((group, index): NameBlock => ({
    start: group[0].top,
    end: groups[index + 1]?.[0].top ?? maxTop,
    lines: group,
  }));
}

function textInColumn(
  line: PositionedLine,
  start: number,
  end: number,
) {
  return joinItems(line.items.filter((item) => item.x >= start && item.x < end));
}

function priceAnchors(lines: PositionedLine[], width: number) {
  const volumeStart = width * 0.65;
  const sourceStart = width * 0.783;
  const clientStart = width * 0.871;

  return lines
    .map((line): PriceAnchor | null => {
      const sourceText = textInColumn(line, sourceStart, clientStart);
      const sourcePrice = parsePrice(sourceText);
      if (!sourcePrice) return null;

      const nearbyVolume = lines
        .filter((candidate) => Math.abs(candidate.top - line.top) <= 22)
        .map((candidate) => textInColumn(candidate, volumeStart, sourceStart))
        .filter(Boolean)
        .join(" ");
      if (!looksLikeVolume(nearbyVolume)) return null;

      const clientPriceText = textInColumn(line, clientStart, width + 1);
      return {
        top: line.top,
        sourcePrice,
        recommendedPrice: parsePrice(clientPriceText),
        clientPriceText,
      };
    })
    .filter((anchor): anchor is PriceAnchor => Boolean(anchor))
    .sort((a, b) => a.top - b.top);
}

function volumeForAnchor(input: {
  lines: PositionedLine[];
  anchors: PriceAnchor[];
  anchorIndex: number;
  blockStart: number;
  blockEnd: number;
  width: number;
}) {
  const { lines, anchors, anchorIndex, blockStart, blockEnd, width } = input;
  const anchor = anchors[anchorIndex];
  const previous = anchors[anchorIndex - 1];
  const next = anchors[anchorIndex + 1];
  const start = Math.max(
    blockStart,
    previous ? (previous.top + anchor.top) / 2 : anchor.top - 24,
  );
  const end = Math.min(
    blockEnd,
    next ? (anchor.top + next.top) / 2 : anchor.top + 24,
  );

  const volumeStart = width * 0.65;
  const sourceStart = width * 0.783;
  return lines
    .filter((line) => line.top >= start && line.top < end)
    .map((line) => textInColumn(line, volumeStart, sourceStart))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRow(input: {
  pageNumber: number;
  rowNumber: number;
  name: string;
  description: string;
  volumeLabel: string;
  sourcePrice: number;
  recommendedPrice: number | null;
  clientPriceText: string;
  category: string;
  sourceDate: string | null;
}): ParsedPriceRow {
  const volume = parseVolume(input.volumeLabel);
  const warnings = ["synthetic_sku_generated"];
  if (!input.recommendedPrice) warnings.push("recommended_price_not_available");
  if (!input.description) warnings.push("description_not_found");
  if (!volume.label) warnings.push("volume_not_found");
  if (/запрет/iu.test(input.clientPriceText)) warnings.push("retail_sale_restricted");

  return {
    pageNumber: input.pageNumber,
    rowNumber: input.rowNumber,
    brand: "MESALTERA",
    supplierSku: syntheticSku(input.name, input.volumeLabel),
    originalName: input.name,
    normalizedName: input.name,
    description: input.description || null,
    volumeValue: volume.value,
    volumeUnit: volume.unit,
    volumeLabel: volume.label,
    sourcePrice: input.sourcePrice,
    recommendedPrice: input.recommendedPrice,
    productLineCode: null,
    productLineName: input.category,
    category: input.category || "Mesaltera",
    sourceDate: input.sourceDate,
    confidence: calculateConfidence({
      name: input.name,
      description: input.description,
      volumeLabel: input.volumeLabel,
      sourcePrice: input.sourcePrice,
      recommendedPrice: input.recommendedPrice,
      category: input.category,
    }),
    warnings,
  };
}

export async function parseMesalteraPdf(bytes: Uint8Array): Promise<PriceParseResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    verbosity: 0,
  });
  const document = await loadingTask.promise;

  if (document.numPages > MAX_PAGES) {
    throw new Error(`pdf_too_many_pages:${document.numPages}`);
  }

  const rows: ParsedPriceRow[] = [];
  const warnings: string[] = [];
  let sourceDate: string | null = null;
  let currentCategory = "Mesaltera";
  let rowNumber = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const positioned: PositionedText[] = [];

    for (const rawItem of textContent.items as PdfTextItem[]) {
      if (!isPdfTextItem(rawItem)) continue;
      const text = cleanText(rawItem.str);
      if (!text) continue;
      const transform = rawItem.transform;
      positioned.push({
        text,
        x: toNumber(transform[4]),
        top: viewport.height - toNumber(transform[5]),
        width: toNumber(rawItem.width),
        height: toNumber(rawItem.height),
      });
    }

    const lines = groupLines(positioned);
    const pageText = lines.map((line) => joinItems(line.items)).join(" ");
    sourceDate = sourceDate || parseDate(pageText);

    const nameEnd = viewport.width * 0.225;
    const descriptionStart = nameEnd;
    const descriptionEnd = viewport.width * 0.65;
    const categories = lines
      .map((line) => ({ top: line.top, text: joinItems(line.items) }))
      .filter((entry) => isCategoryText(entry.text));

    const accessoryCategory = categories.find((entry) =>
      normalizeText(entry.text).includes("аксессуар"),
    );
    const anchors = priceAnchors(lines, viewport.width);
    const accessoryStart = accessoryCategory?.top ?? viewport.height + 1;
    const normalBlocks = nameBlocks(lines, nameEnd, accessoryStart);

    const categoryAt = (top: number) => {
      const candidate = categories.filter((entry) => entry.top < top).at(-1);
      if (candidate) currentCategory = categoryLabel(candidate.text);
      return currentCategory;
    };

    for (const block of normalBlocks) {
      const blockStart = Math.max(0, block.start - 7);
      const blockEnd = Math.min(accessoryStart, block.end - 4);
      const blockAnchors = anchors.filter(
        (anchor) => anchor.top >= blockStart && anchor.top < blockEnd,
      );
      if (!blockAnchors.length) continue;

      const name = joinLines(
        block.lines.map((line) => ({
          ...line,
          items: line.items.filter((item) => item.x < nameEnd),
        })),
      ).replace(/\n/g, " ");
      if (!name || isHeader(name)) continue;

      const description = joinLines(
        lines
          .filter((line) => line.top >= blockStart && line.top < blockEnd)
          .map((line) => ({
            ...line,
            items: line.items.filter(
              (item) => item.x >= descriptionStart && item.x < descriptionEnd,
            ),
          }))
          .filter((line) => line.items.length > 0),
      );
      const category = categoryAt(block.start);

      for (let index = 0; index < blockAnchors.length; index += 1) {
        const anchor = blockAnchors[index];
        const volumeLabel = volumeForAnchor({
          lines,
          anchors: blockAnchors,
          anchorIndex: index,
          blockStart,
          blockEnd,
          width: viewport.width,
        });

        rowNumber += 1;
        rows.push(
          buildRow({
            pageNumber,
            rowNumber,
            name,
            description,
            volumeLabel,
            sourcePrice: anchor.sourcePrice,
            recommendedPrice: anchor.recommendedPrice,
            clientPriceText: anchor.clientPriceText,
            category,
            sourceDate,
          }),
        );
      }
    }

    if (accessoryCategory) {
      currentCategory = "Аксессуары";
      const accessoryAnchors = anchors.filter(
        (anchor) => anchor.top > accessoryCategory.top,
      );

      for (let index = 0; index < accessoryAnchors.length; index += 1) {
        const anchor = accessoryAnchors[index];
        const previous = accessoryAnchors[index - 1];
        const next = accessoryAnchors[index + 1];
        const start = previous ? (previous.top + anchor.top) / 2 : anchor.top - 9;
        const end = next ? (anchor.top + next.top) / 2 : anchor.top + 9;
        const name = joinLines(
          lines
            .filter((line) => line.top >= start && line.top < end)
            .map((line) => ({
              ...line,
              items: line.items.filter((item) => item.x < nameEnd),
            }))
            .filter((line) => line.items.length > 0),
        ).replace(/\n/g, " ");
        if (!name) continue;

        const volumeLabel = volumeForAnchor({
          lines,
          anchors: accessoryAnchors,
          anchorIndex: index,
          blockStart: start,
          blockEnd: end,
          width: viewport.width,
        });
        rowNumber += 1;
        rows.push(
          buildRow({
            pageNumber,
            rowNumber,
            name,
            description: "",
            volumeLabel,
            sourcePrice: anchor.sourcePrice,
            recommendedPrice: anchor.recommendedPrice,
            clientPriceText: anchor.clientPriceText,
            category: currentCategory,
            sourceDate,
          }),
        );
      }
    }

    const lastCategory = categories.at(-1);
    if (lastCategory) currentCategory = categoryLabel(lastCategory.text);
  }

  if (!rows.length) throw new Error("no_price_rows_found");
  if (!sourceDate) warnings.push("source_date_not_found");

  const missingRetail = rows.filter((row) => !row.recommendedPrice).length;
  if (missingRetail) warnings.push(`recommended_price_missing:${missingRetail}`);

  return {
    parserId: "MESALTERA_PDF",
    sourceDate,
    pageCount: document.numPages,
    rows,
    warnings,
  };
}
