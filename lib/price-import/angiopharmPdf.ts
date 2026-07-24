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

type ProductLine = {
  code: string;
  name: string;
  category: string;
};

export type ParsedAngiopharmRow = {
  pageNumber: number;
  rowNumber: number;
  brand: "ANGIOPHARM";
  supplierSku: string | null;
  originalName: string;
  normalizedName: string;
  volumeValue: number | null;
  volumeUnit: "ml" | "g" | "pcs" | "pack" | "roll" | null;
  volumeLabel: string;
  sourcePrice: number;
  productLineCode: string | null;
  productLineName: string | null;
  category: string;
  sourceDate: string | null;
  confidence: number;
  warnings: string[];
};

export type AngiopharmParseResult = {
  sourceDate: string | null;
  pageCount: number;
  rows: ParsedAngiopharmRow[];
  warnings: string[];
};

const MAX_PAGES = 20;
const ROW_TOLERANCE = 2.4;
const SKU_RE = /\b([A-Z]{2,4}\d{2})\s*$/i;
const DATE_RE = /\b(\d{2})\.(\d{2})\.(\d{4})\b/;

const LINE_CATEGORY: Record<string, string> = {
  CL: "Очищение и тонизация",
  "RG AV": "Регенерация",
  AG: "Антивозрастной уход",
  DR: "Дренаж",
  WH: "Осветление",
  RS: "Ретиноиды",
  AC: "Антикупероз",
  SE: "Чувствительная кожа",
  AA: "Проблемная кожа",
  CT: "Восстановление кожного барьера",
  MS: "Увлажнение",
  LC: "Уход за губами",
  AO: "Антиоксидантный уход",
  SPF: "Защита от солнца",
  RR: "Обновление сияния",
  BD: "Уход за телом",
  CX: "Карбокситерапия",
  PL: "Пилинги",
  OC: "Уход за полостью рта",
  AT: "Ароматерапия",
  MERCH: "Аксессуары",
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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

function groupRows(items: PositionedText[]) {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);
  const rows: Array<{ top: number; items: PositionedText[] }> = [];

  for (const item of sorted) {
    const last = rows.at(-1);
    if (last && Math.abs(last.top - item.top) <= ROW_TOLERANCE) {
      last.items.push(item);
      last.top = (last.top * (last.items.length - 1) + item.top) / last.items.length;
    } else {
      rows.push({ top: item.top, items: [item] });
    }
  }

  return rows.map((row) => ({
    top: row.top,
    items: row.items.sort((a, b) => a.x - b.x),
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

function parseDate(text: string) {
  const match = text.match(DATE_RE);
  if (!match) return null;

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function parsePrice(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;

  const price = Number(digits);
  if (!Number.isInteger(price) || price <= 0) return null;
  return price;
}

function parseVolume(value: string): {
  value: number | null;
  unit: ParsedAngiopharmRow["volumeUnit"];
  label: string;
} {
  const label = value.replace(/\s+/g, " ").trim();
  const normalized = label.toLowerCase().replace(/ё/g, "е");
  const numberMatch = normalized.match(/\d+(?:[.,]\d+)?/);
  const numericValue = numberMatch
    ? Math.max(0, Math.round(Number(numberMatch[0].replace(",", "."))))
    : null;

  if (/упак/.test(normalized)) {
    return { value: numericValue, unit: "pack", label };
  }
  if (/рулон/.test(normalized)) {
    return { value: numericValue, unit: "roll", label };
  }
  if (/шт/.test(normalized)) {
    return { value: numericValue ?? 1, unit: "pcs", label };
  }
  if (/(?:гр\.?|\bг\b)/.test(normalized)) {
    return { value: numericValue, unit: "g", label };
  }
  if (numericValue !== null) {
    return { value: numericValue, unit: "ml", label };
  }

  return { value: null, unit: null, label };
}

function detectProductLine(text: string): ProductLine | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const upper = normalized.toUpperCase();

  if (upper.includes("АКСЕССУАРЫ") && upper.includes("ANGIOPHARM")) {
    return { code: "MERCH", name: "Аксессуары ANGIOPHARM", category: "Аксессуары" };
  }

  const parts = normalized.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const rawCode = parts[0].toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(LINE_CATEGORY, rawCode)) return null;

  const russianName = parts.at(-1) || LINE_CATEGORY[rawCode];
  let category = LINE_CATEGORY[rawCode];

  if (rawCode === "BD" && /ВОЛОС|ДУША/i.test(russianName)) {
    category = "Уход за волосами и душем";
  }

  return { code: rawCode, name: russianName, category };
}

function isTableHeader(text: string) {
  const upper = text.toUpperCase();
  return (
    upper.includes("НАИМЕНОВАНИЕ") ||
    upper.includes("ОБЪЁМ") ||
    upper.includes("ОБЪЕМ") ||
    upper.includes("ЦЕНА, ТГ")
  );
}

function calculateConfidence(input: {
  name: string;
  sku: string | null;
  price: number | null;
  volumeUnit: ParsedAngiopharmRow["volumeUnit"];
  line: ProductLine | null;
}) {
  let confidence = 0;
  if (input.name.length >= 3) confidence += 35;
  if (input.price !== null) confidence += 30;
  if (input.volumeUnit !== null) confidence += 15;
  if (input.sku) confidence += 15;
  if (input.line) confidence += 5;
  return confidence;
}

export async function parseAngiopharmPdf(
  bytes: Uint8Array,
): Promise<AngiopharmParseResult> {
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

  const parsedRows: ParsedAngiopharmRow[] = [];
  const parserWarnings: string[] = [];
  let sourceDate: string | null = null;
  let currentLine: ProductLine | null = null;
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

    const rows = groupRows(positioned);
    const pageText = rows.map((row) => joinItems(row.items)).join(" ");
    sourceDate = sourceDate || parseDate(pageText);

    const nameBoundary = viewport.width * 0.72;
    const priceBoundary = viewport.width * 0.84;

    for (const row of rows) {
      const entireRow = joinItems(row.items);
      if (!entireRow || isTableHeader(entireRow)) continue;

      const detectedLine = detectProductLine(entireRow);
      if (detectedLine) {
        currentLine = detectedLine;
        continue;
      }

      const nameText = joinItems(row.items.filter((item) => item.x < nameBoundary));
      const volumeText = joinItems(
        row.items.filter((item) => item.x >= nameBoundary && item.x < priceBoundary),
      );
      const priceText = joinItems(
        row.items.filter((item) => item.x >= priceBoundary),
        "",
      );

      const price = parsePrice(priceText);
      if (!nameText || price === null) continue;

      const volume = parseVolume(volumeText);
      const skuMatch = nameText.match(SKU_RE);
      const supplierSku = skuMatch ? skuMatch[1].toUpperCase() : null;
      const normalizedName = supplierSku
        ? nameText.replace(SKU_RE, "").replace(/\s+/g, " ").trim()
        : nameText.trim();

      const warnings: string[] = [];
      if (!supplierSku) warnings.push("sku_not_found");
      if (!volumeText) warnings.push("volume_not_found");
      if (!currentLine) warnings.push("product_line_not_found");

      rowNumber += 1;
      parsedRows.push({
        pageNumber,
        rowNumber,
        brand: "ANGIOPHARM",
        supplierSku,
        originalName: nameText,
        normalizedName,
        volumeValue: volume.value,
        volumeUnit: volume.unit,
        volumeLabel: volume.label,
        sourcePrice: price,
        productLineCode: currentLine?.code ?? null,
        productLineName: currentLine?.name ?? null,
        category: currentLine?.category ?? "Без категории",
        sourceDate,
        confidence: calculateConfidence({
          name: normalizedName,
          sku: supplierSku,
          price,
          volumeUnit: volume.unit,
          line: currentLine,
        }),
        warnings,
      });
    }
  }

  if (parsedRows.length === 0) {
    throw new Error("no_price_rows_found");
  }

  if (!sourceDate) parserWarnings.push("source_date_not_found");

  return {
    sourceDate,
    pageCount: document.numPages,
    rows: parsedRows,
    warnings: parserWarnings,
  };
}
