import { createHash } from "node:crypto";
import { extractJeudermEmbeddedImages } from "./jeudermEmbeddedImages";
import { uploadEmbeddedPriceImages } from "./priceImportImages";
import type { EmbeddedPriceImage, ParsedPriceRow, PriceParseResult, PriceVolumeUnit } from "./types";

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

type TextRow = {
  top: number;
  text: string;
  height: number;
};

const MAX_PAGES = 20;
const ROW_TOLERANCE = 2.6;
const TITLE_HEIGHT = 12.8;

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

function groupRows(items: PositionedText[]): TextRow[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);
  const grouped: Array<{ top: number; items: PositionedText[] }> = [];

  for (const item of sorted) {
    const lastRows = grouped.slice(-3);
    let target: { top: number; items: PositionedText[] } | undefined;

    for (const candidate of lastRows) {
      if (Math.abs(candidate.top - item.top) <= ROW_TOLERANCE) {
        target = candidate;
        break;
      }
    }

    if (target) {
      target.items.push(item);
      target.top =
        (target.top * (target.items.length - 1) + item.top) / target.items.length;
    } else {
      grouped.push({ top: item.top, items: [item] });
    }
  }

  return grouped
    .sort((a, b) => a.top - b.top)
    .map((row) => {
      const ordered = row.items.sort((a, b) => a.x - b.x);
      let height = 0;
      for (const item of ordered) height = Math.max(height, item.height);

      return {
        top: row.top,
        text: ordered
          .map((item) => item.text)
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        height,
      };
    });
}

function moneyValues(value: string) {
  const matches = value.match(/\d(?:[\d\s]*\d)?/g) || [];
  const result: number[] = [];

  for (const match of matches) {
    const number = Number(match.replace(/\s+/g, ""));
    if (Number.isInteger(number) && number >= 1000) result.push(number);
  }

  return result;
}

function parsePrices(priceRow: string, supplementalRow: string) {
  const marker = priceRow.match(/цена\s*:/i);
  if (!marker || typeof marker.index !== "number") {
    return { sourcePrice: null as number | null, recommendedPrice: null as number | null };
  }

  const prices = moneyValues(priceRow.slice(marker.index + marker[0].length));
  const sourcePrice = prices.length ? prices[0] : null;
  let recommendedPrice = prices.length > 1 ? prices[1] : null;

  if (
    sourcePrice !== null &&
    recommendedPrice === null &&
    priceRow.includes("/") &&
    supplementalRow
  ) {
    const supplemental = moneyValues(supplementalRow);
    if (supplemental.length) recommendedPrice = supplemental[supplemental.length - 1];
  }

  return { sourcePrice, recommendedPrice };
}

function parseVolume(text: string): {
  value: number | null;
  unit: PriceVolumeUnit;
  label: string;
} {
  const match = text.match(
    /объ[её]м\s*:\s*(\d+(?:[.,]\d+)?)\s*(млг|мл|гр\.?|г\b|шт|уп(?:\.|аковка)?)?/i,
  );
  if (!match) return { value: null, unit: null, label: "" };

  const numeric = Number(match[1].replace(",", "."));
  const value = Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : null;
  const rawUnit = normalizeText(match[2] || "");
  let unit: PriceVolumeUnit = null;

  if (rawUnit.startsWith("мл")) unit = "ml";
  else if (rawUnit === "г" || rawUnit.startsWith("гр")) unit = "g";
  else if (rawUnit.startsWith("шт")) unit = "pcs";
  else if (rawUnit.startsWith("уп")) unit = "pack";

  return {
    value,
    unit,
    label: cleanText(match[0].replace(/^объ[её]м\s*:\s*/i, "")),
  };
}

function stripVolume(text: string) {
  return cleanText(text.replace(/\s*объ[её]м\s*:.*$/i, ""));
}

function isFooter(text: string) {
  const normalized = normalizeText(text);
  return (
    /^г\.\s*(?:алматы|астана)/i.test(normalized) ||
    /^\+?7[\d\s()-]{7,}$/.test(text.trim())
  );
}

function syntheticSku(name: string, volumeLabel: string) {
  const source = normalizeText(`${name}::${volumeLabel}`);
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `JD-${(hash >>> 0).toString(36).toUpperCase().padStart(7, "0")}`;
}

export async function parseJeudermPdf(
  bytes: Uint8Array,
  brand = "JeuDerm",
): Promise<PriceParseResult> {
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

  const parsedRows: ParsedPriceRow[] = [];
  const visualIndexByRowNumber = new Map<number, number>();
  let rowNumber = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const columns: PositionedText[][] = [[], [], []];

    for (const rawItem of textContent.items as PdfTextItem[]) {
      if (!isPdfTextItem(rawItem)) continue;
      const text = cleanText(rawItem.str);
      if (!text) continue;

      const transform = rawItem.transform;
      const item: PositionedText = {
        text,
        x: toNumber(transform[4]),
        top: viewport.height - toNumber(transform[5]),
        width: toNumber(rawItem.width),
        height: toNumber(rawItem.height),
      };
      const center = item.x + item.width / 2;
      let columnIndex = Math.floor(center / (viewport.width / 3));
      columnIndex = Math.max(0, Math.min(2, columnIndex));
      columns[columnIndex].push(item);
    }

    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const columnItems = columns[columnIndex];
      const rows = groupRows(columnItems);
      let nameParts: string[] = [];
      let bodyRows: string[] = [];
      let bodyStarted = false;
      let cardInColumn = 0;

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row.text || isFooter(row.text)) continue;

        const isPrice = /цена\s*:/i.test(row.text);
        const isTitle = row.height >= TITLE_HEIGHT && !isPrice;

        if (!nameParts.length) {
          if (isTitle) {
            nameParts = [row.text];
            bodyRows = [];
            bodyStarted = false;
          }
          continue;
        }

        if (isPrice) {
          const beforePrice = [...nameParts, ...bodyRows].join(" ");
          let supplementalRow = "";
          const next = rows[index + 1];

          if (
            !/объ[её]м\s*:/i.test(beforePrice) &&
            next &&
            /объ[её]м\s*:/i.test(next.text)
          ) {
            supplementalRow = next.text;
            index += 1;
          }

          const name = cleanText(nameParts.join(" "));
          const combinedText = [
            ...nameParts,
            ...bodyRows,
            row.text,
            supplementalRow,
          ]
            .filter(Boolean)
            .join(" ");
          const volume = parseVolume(combinedText);
          const prices = parsePrices(row.text, supplementalRow);
          const visualIndex = cardInColumn * 3 + columnIndex;
          cardInColumn += 1;

          if (name && prices.sourcePrice !== null) {
            const description = cleanText(
              bodyRows.map(stripVolume).filter(Boolean).join(" "),
            );
            const warnings = ["synthetic_sku"];
            if (volume.value === null) warnings.push("volume_not_found");
            if (prices.recommendedPrice === null) {
              warnings.push("recommended_price_not_found");
            }

            rowNumber += 1;
            parsedRows.push({
              pageNumber,
              rowNumber,
              brand: cleanText(brand) || "JeuDerm",
              supplierSku: syntheticSku(name, volume.label),
              originalName: name,
              normalizedName: name,
              description: description || null,
              volumeValue: volume.value,
              volumeUnit: volume.unit,
              volumeLabel: volume.label,
              sourcePrice: prices.sourcePrice,
              recommendedPrice: prices.recommendedPrice,
              productLineCode: null,
              productLineName: null,
              category: "Без категории",
              sourceDate: null,
              confidence: volume.value !== null ? 95 : 85,
              warnings,
            });
            visualIndexByRowNumber.set(rowNumber, visualIndex);
          }

          nameParts = [];
          bodyRows = [];
          bodyStarted = false;
          continue;
        }

        if (isTitle && !bodyStarted) {
          nameParts.push(row.text);
          continue;
        }

        if (isTitle && bodyStarted) {
          nameParts = [row.text];
          bodyRows = [];
          bodyStarted = false;
          continue;
        }

        bodyStarted = true;
        bodyRows.push(row.text);
      }
    }
  }

  if (!parsedRows.length) throw new Error("no_price_rows_found");

  parsedRows.sort(
    (a, b) => a.pageNumber - b.pageNumber || a.rowNumber - b.rowNumber,
  );

  const warnings = ["source_date_not_found", "synthetic_skus_generated"];
  const embeddedByPage = extractJeudermEmbeddedImages(bytes);
  const embeddedImages: EmbeddedPriceImage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const pageRows = parsedRows
      .filter((row) => row.pageNumber === pageNumber)
      .sort(
        (a, b) =>
          (visualIndexByRowNumber.get(a.rowNumber) ?? Number.MAX_SAFE_INTEGER) -
          (visualIndexByRowNumber.get(b.rowNumber) ?? Number.MAX_SAFE_INTEGER),
      );
    const pageImages = embeddedByPage.get(pageNumber) || [];

    if (pageRows.length !== pageImages.length) {
      warnings.push(
        `embedded_image_count_mismatch:${pageNumber}:${pageRows.length}:${pageImages.length}`,
      );
    }

    const count = Math.min(pageRows.length, pageImages.length);
    for (let index = 0; index < count; index += 1) {
      const row = pageRows[index];
      const image = pageImages[index];
      embeddedImages.push({
        rowNumber: row.rowNumber,
        pageNumber,
        mimeType: image.mimeType,
        dataBase64: image.dataBase64,
        width: image.width,
        height: image.height,
      });
    }
  }

  if (embeddedImages.length) {
    warnings.push(`embedded_images_found:${embeddedImages.length}`);
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const uploaded = await uploadEmbeddedPriceImages({
      fileHash,
      images: embeddedImages,
      concurrency: 6,
    });
    warnings.push(...uploaded.warnings);

    for (const row of parsedRows) {
      row.priceImageUrl = uploaded.urls.get(row.rowNumber) || null;
    }
    warnings.push(`embedded_images_uploaded:${uploaded.urls.size}`);
  }

  return {
    parserId: "JEUDERM_PDF",
    sourceDate: null,
    pageCount: document.numPages,
    rows: parsedRows,
    warnings,
  };
}
