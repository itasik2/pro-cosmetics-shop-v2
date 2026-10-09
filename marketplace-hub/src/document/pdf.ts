import type { ImportedRow } from "../offline/importer.js";

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

type PositionedRow = {
  top: number;
  items: PositionedText[];
};

type PdfColumn =
  | "sku"
  | "barcode"
  | "title"
  | "brand"
  | "description"
  | "volume"
  | "price"
  | "stock"
  | "category";

type ColumnDefinition = {
  key: PdfColumn;
  start: number;
};

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 50;
const ROW_TOLERANCE = 2.8;

const HEADER_MATCHERS: Array<[PdfColumn, RegExp]> = [
  ["sku", /^(?:артикул|sku|код(?:\s+товара|\s+продукта)?)$/iu],
  ["barcode", /^(?:штрих.?код|ean|barcode)$/iu],
  ["title", /^(?:наименование|название|товар|продукт)$/iu],
  ["brand", /^(?:бренд|марка|производитель)$/iu],
  ["description", /^(?:описание|description)$/iu],
  ["volume", /^(?:объ[её]м|фасовка|размер)$/iu],
  ["price", /^(?:цена|стоимость|опт|оптовая\s+цена)$/iu],
  ["stock", /^(?:остаток|наличие|кол(?:-?во|ичество)?)$/iu],
  ["category", /^(?:категория|раздел|линия|серия)$/iu],
];

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeHeader(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[.:,]/g, "")
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

function groupRows(items: PositionedText[]): PositionedRow[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);
  const rows: PositionedRow[] = [];

  for (const item of sorted) {
    const target = rows
      .slice(-4)
      .find((row) => Math.abs(row.top - item.top) <= ROW_TOLERANCE);

    if (target) {
      target.items.push(item);
      target.top =
        (target.top * (target.items.length - 1) + item.top) /
        target.items.length;
    } else {
      rows.push({ top: item.top, items: [item] });
    }
  }

  return rows
    .sort((a, b) => a.top - b.top)
    .map((row) => ({
      ...row,
      items: row.items.sort((a, b) => a.x - b.x),
    }));
}

function joinItems(items: PositionedText[]) {
  return items
    .map((item) => item.text)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function headerKey(text: string): PdfColumn | null {
  const normalized = normalizeHeader(text);

  for (const [key, matcher] of HEADER_MATCHERS) {
    if (matcher.test(normalized)) return key;
  }

  return null;
}

function detectColumns(row: PositionedRow): ColumnDefinition[] | null {
  const columns = new Map<PdfColumn, number>();

  for (const item of row.items) {
    const key = headerKey(item.text);
    if (key && !columns.has(key)) columns.set(key, item.x);
  }

  if (!columns.has("title") || !columns.has("price")) return null;

  return [...columns.entries()]
    .map(([key, start]) => ({ key, start }))
    .sort((a, b) => a.start - b.start);
}

function readColumn(
  row: PositionedRow,
  columns: ColumnDefinition[],
  index: number,
  viewportWidth: number,
) {
  const start = columns[index].start;
  const end = columns[index + 1]?.start ?? viewportWidth + 1;
  return joinItems(row.items.filter((item) => item.x >= start && item.x < end));
}

export type PdfCatalogPreview = {
  pageCount: number;
  rows: ImportedRow[];
  columns: string[];
  warnings: string[];
  textCharacters: number;
  scannedLikePages: number[];
  ocrRecommended: boolean;
};

export async function extractPdfCatalogRows(
  bytes: Uint8Array,
): Promise<PdfCatalogPreview> {
  if (!bytes.byteLength) throw new Error("pdf_empty");
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error("pdf_too_large");

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    verbosity: 0,
  });
  const document = await task.promise;

  if (document.numPages > MAX_PAGES) {
    throw new Error(`pdf_too_many_pages:${document.numPages}`);
  }

  const resultRows: ImportedRow[] = [];
  const warnings: string[] = [];
  const scannedLikePages: number[] = [];
  const detectedColumnNames = new Set<string>();
  let textCharacters = 0;
  let pagesWithTable = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    const positioned: PositionedText[] = [];
    for (const rawItem of textContent.items as PdfTextItem[]) {
      if (!isPdfTextItem(rawItem)) continue;
      const text = cleanText(rawItem.str);
      if (!text) continue;

      textCharacters += text.length;
      positioned.push({
        text,
        x: toNumber(rawItem.transform[4]),
        top: viewport.height - toNumber(rawItem.transform[5]),
        width: toNumber(rawItem.width),
        height: toNumber(rawItem.height),
      });
    }

    const pageCharacterCount = positioned.reduce(
      (sum, item) => sum + item.text.length,
      0,
    );

    if (pageCharacterCount < 20) {
      scannedLikePages.push(pageNumber);
      continue;
    }

    const rows = groupRows(positioned);
    let columns: ColumnDefinition[] | null = null;
    let pageHasTable = false;

    for (const row of rows) {
      const detected = detectColumns(row);
      if (detected) {
        columns = detected;
        pageHasTable = true;
        for (const column of columns) detectedColumnNames.add(column.key);
        continue;
      }

      if (!columns) continue;

      const parsed: ImportedRow = {
        _page: String(pageNumber),
      };

      columns.forEach((column, index) => {
        parsed[column.key] = readColumn(row, columns!, index, viewport.width);
      });

      const meaningful = Object.entries(parsed).some(
        ([key, value]) => key !== "_page" && value.trim().length > 0,
      );

      if (meaningful) resultRows.push(parsed);
    }

    if (pageHasTable) pagesWithTable += 1;
  }

  if (scannedLikePages.length) {
    warnings.push(
      `pages_without_text_layer:${scannedLikePages.join(",")}`,
    );
  }

  if (!pagesWithTable) {
    warnings.push("table_header_not_detected");
  }

  if (!resultRows.length) {
    warnings.push("no_structured_rows_detected");
  }

  const ocrRecommended =
    scannedLikePages.length > 0 &&
    scannedLikePages.length >= Math.ceil(document.numPages / 2);

  if (ocrRecommended) warnings.push("ocr_recommended");

  return {
    pageCount: document.numPages,
    rows: resultRows,
    columns: [...detectedColumnNames].sort(),
    warnings,
    textCharacters,
    scannedLikePages,
    ocrRecommended,
  };
}
