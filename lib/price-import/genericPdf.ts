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

type PositionedRow = {
  top: number;
  items: PositionedText[];
};

type ColumnKey = "brand" | "sku" | "name" | "volume" | "price" | "category";

type ColumnDefinition = {
  key: ColumnKey;
  start: number;
};

const MAX_PAGES = 40;
const ROW_TOLERANCE = 2.6;
const DATE_RE = /\b(\d{2})[./-](\d{2})[./-](\d{4})\b/;
const SKU_AT_END_RE = /\b([A-ZА-Я]{1,10}[-_/]?[A-ZА-Я0-9._/-]*\d[A-ZА-Я0-9._/-]{0,20})\s*$/iu;

const HEADER_MATCHERS: Array<[ColumnKey, RegExp]> = [
  ["brand", /^(?:бренд|марка|производитель)$/iu],
  ["sku", /(?:артикул|\bsku\b|код\s*(?:товара|продукта)?)/iu],
  ["name", /(?:наименование|название|товар|продукт)/iu],
  ["volume", /(?:объ[её]м|фасовка|размер|кол(?:-?во|ичество)?)/iu],
  ["price", /(?:цена|стоимость|опт)/iu],
  ["category", /(?:категория|раздел|линия|серия)/iu],
];

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function normalizeBrand(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
    const closest = rows
      .slice(-3)
      .find((row) => Math.abs(row.top - item.top) <= ROW_TOLERANCE);

    if (closest) {
      closest.items.push(item);
      closest.top =
        (closest.top * (closest.items.length - 1) + item.top) / closest.items.length;
    } else {
      rows.push({ top: item.top, items: [item] });
    }
  }

  return rows
    .sort((a, b) => a.top - b.top)
    .map((row) => ({ ...row, items: row.items.sort((a, b) => a.x - b.x) }));
}

function joinItems(items: PositionedText[], separator = " ") {
  return items
    .map((item) => item.text)
    .filter(Boolean)
    .join(separator)
    .replace(/\s+/g, " ")
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
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  if (!normalized) return null;
  const price = Number(normalized);
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.round(price);
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

  if (/упак|комплект|набор/.test(normalized)) {
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
  if (/(?:л\b|литр)/.test(normalized) && !/(?:мл|миллилитр)/.test(normalized)) {
    return {
      value: numericValue === null ? null : numericValue * 1000,
      unit: "ml",
      label,
    };
  }
  if (/(?:мл|миллилитр)/.test(normalized)) {
    return { value: numericValue, unit: "ml", label };
  }
  if (numericValue !== null) {
    return { value: numericValue, unit: null, label };
  }

  return { value: null, unit: null, label };
}

function headerKey(text: string): ColumnKey | null {
  const normalized = normalizeText(text).replace(/[.:,]/g, "");
  for (const [key, matcher] of HEADER_MATCHERS) {
    if (matcher.test(normalized)) return key;
  }
  return null;
}

function detectColumns(row: PositionedRow): ColumnDefinition[] | null {
  const columns = new Map<ColumnKey, number>();

  for (const item of row.items) {
    const key = headerKey(item.text);
    if (key && !columns.has(key)) columns.set(key, item.x);
  }

  if (!columns.has("name") || !columns.has("price")) return null;

  return [...columns.entries()]
    .map(([key, start]) => ({ key, start }))
    .sort((a, b) => a.start - b.start);
}

function readColumn(
  row: PositionedRow,
  columns: ColumnDefinition[],
  key: ColumnKey,
  viewportWidth: number,
) {
  const index = columns.findIndex((column) => column.key === key);
  if (index < 0) return "";

  const start = columns[index].start;
  const end = columns[index + 1]?.start ?? viewportWidth + 1;
  return joinItems(row.items.filter((item) => item.x >= start && item.x < end));
}

function fallbackColumns(row: PositionedRow, viewportWidth: number) {
  const nameBoundary = viewportWidth * 0.7;
  const priceBoundary = viewportWidth * 0.84;

  return {
    brandText: "",
    skuText: "",
    nameText: joinItems(row.items.filter((item) => item.x < nameBoundary)),
    volumeText: joinItems(
      row.items.filter((item) => item.x >= nameBoundary && item.x < priceBoundary),
    ),
    priceText: joinItems(row.items.filter((item) => item.x >= priceBoundary), ""),
    categoryText: "",
  };
}

function rowValues(
  row: PositionedRow,
  columns: ColumnDefinition[] | null,
  viewportWidth: number,
) {
  if (!columns) return fallbackColumns(row, viewportWidth);

  return {
    brandText: readColumn(row, columns, "brand", viewportWidth),
    skuText: readColumn(row, columns, "sku", viewportWidth),
    nameText: readColumn(row, columns, "name", viewportWidth),
    volumeText: readColumn(row, columns, "volume", viewportWidth),
    priceText: readColumn(row, columns, "price", viewportWidth),
    categoryText: readColumn(row, columns, "category", viewportWidth),
  };
}

function normalizeSku(value: string) {
  const sku = cleanText(value).replace(/^[:#№\s]+/, "").toUpperCase();
  return sku.length >= 2 && sku.length <= 50 ? sku : null;
}

function calculateConfidence(input: {
  name: string;
  brand: string;
  sku: string | null;
  price: number | null;
  volumeUnit: PriceVolumeUnit;
  category: string;
}) {
  let confidence = 0;
  if (input.name.length >= 3) confidence += 30;
  if (input.price !== null) confidence += 25;
  if (input.brand) confidence += 15;
  if (input.sku) confidence += 15;
  if (input.volumeUnit !== null) confidence += 10;
  if (input.category && input.category !== "Без категории") confidence += 5;
  return confidence;
}

function markDuplicateSkus(rows: ParsedPriceRow[]) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (!row.supplierSku) continue;
    const key = `${normalizeText(row.brand)}::${row.supplierSku}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const duplicateKeys = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
  );

  return rows.map((row) => {
    if (!row.supplierSku) return row;
    const key = `${normalizeText(row.brand)}::${row.supplierSku}`;
    if (!duplicateKeys.has(key)) return row;

    return {
      ...row,
      confidence: Math.min(row.confidence, 60),
      warnings: [...new Set([...row.warnings, "duplicate_sku_in_file"])],
    };
  });
}

export async function parseGenericPdf(input: {
  bytes: Uint8Array;
  defaultBrand?: string | null;
}): Promise<PriceParseResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: input.bytes,
    useSystemFonts: true,
    verbosity: 0,
  });
  const document = await loadingTask.promise;

  if (document.numPages > MAX_PAGES) {
    throw new Error(`pdf_too_many_pages:${document.numPages}`);
  }

  const defaultBrand = normalizeBrand(input.defaultBrand || "");
  const parsedRows: ParsedPriceRow[] = [];
  const warnings: string[] = [];
  let sourceDate: string | null = null;
  let rowNumber = 0;
  let detectedBrandColumn = false;

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

    const rows = groupRows(positioned);
    const pageText = rows.map((row) => joinItems(row.items)).join(" ");
    sourceDate = sourceDate || parseDate(pageText);

    let columns: ColumnDefinition[] | null = null;

    for (const row of rows) {
      const detected = detectColumns(row);
      if (detected) {
        columns = detected;
        if (columns.some((column) => column.key === "brand")) {
          detectedBrandColumn = true;
        }
        continue;
      }

      const values = rowValues(row, columns, viewport.width);
      const price = parsePrice(values.priceText);
      if (!values.nameText || price === null) continue;

      let supplierSku = normalizeSku(values.skuText);
      let normalizedName = cleanText(values.nameText);

      if (!supplierSku) {
        const skuMatch = normalizedName.match(SKU_AT_END_RE);
        if (skuMatch) {
          supplierSku = normalizeSku(skuMatch[1]);
          normalizedName = normalizedName.replace(SKU_AT_END_RE, "").trim();
        }
      }

      const brand = normalizeBrand(values.brandText || defaultBrand);
      const volume = parseVolume(values.volumeText);
      const category = cleanText(values.categoryText) || "Без категории";
      const rowWarnings: string[] = [];

      if (!brand) rowWarnings.push("brand_not_found");
      if (!supplierSku) rowWarnings.push("sku_not_found");
      if (!values.volumeText) rowWarnings.push("volume_not_found");
      if (!columns) rowWarnings.push("fallback_columns_used");

      rowNumber += 1;
      parsedRows.push({
        pageNumber,
        rowNumber,
        brand,
        supplierSku,
        originalName: cleanText(values.nameText),
        normalizedName,
        volumeValue: volume.value,
        volumeUnit: volume.unit,
        volumeLabel: volume.label,
        sourcePrice: price,
        productLineCode: null,
        productLineName: null,
        category,
        sourceDate,
        confidence: calculateConfidence({
          name: normalizedName,
          brand,
          sku: supplierSku,
          price,
          volumeUnit: volume.unit,
          category,
        }),
        warnings: rowWarnings,
      });
    }
  }

  if (!parsedRows.length) throw new Error("no_price_rows_found");
  if (!sourceDate) warnings.push("source_date_not_found");
  if (!defaultBrand && !detectedBrandColumn) {
    throw new Error("default_brand_required_or_brand_column_missing");
  }

  return {
    parserId: "GENERIC_PDF",
    sourceDate,
    pageCount: document.numPages,
    rows: markDuplicateSkus(parsedRows),
    warnings,
  };
}
