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

type CardRow = {
  top: number;
  items: PositionedText[];
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

function joinItems(items: PositionedText[]) {
  return items
    .map((item) => item.text)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function groupRows(items: PositionedText[]): CardRow[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);
  const rows: Array<{ top: number; items: PositionedText[] }> = [];

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
    .map((row) => {
      const ordered = row.items.sort((a, b) => a.x - b.x);
      return {
        top: row.top,
        items: ordered,
        text: joinItems(ordered),
        height: Math.max(...ordered.map((item) => item.height), 0),
      };
    });
}

function moneyValues(value: string) {
  const matches = value.match(/\d(?:[\d\s]*\d)?/g) || [];
  return matches
    .map((match) => Number(match.replace(/\s+/g, "")))
    .filter((price) => Number.isInteger(price) && price >= 1_000);
}

function parsePrices(priceRow: string, supplementalRow = "") {
  const marker = priceRow.match(/цена\s*:/iu);
  if (!marker || marker.index === undefined) {
    return { sourcePrice: null, recommendedPrice: null };
  }

  const values = moneyValues(priceRow.slice(marker.index + marker[0].length));
  const sourcePrice = values[0] ?? null;
  let recommendedPrice = values[1] ?? null;

  if (
    sourcePrice !== null &&
    recommendedPrice === null &&
    priceRow.includes("/") &&
    supplementalRow
  ) {
    const supplementalValues = moneyValues(supplementalRow);
    recommendedPrice = supplementalValues.at(-1) ?? null;
  }

  return { sourcePrice, recommendedPrice };
}

function parseVolume(text: string): {
  value: number | null;
  unit: PriceVolumeUnit;
  label: string;
} {
  const match = text.match(
    /объ[её]м\s*:\s*(\d+(?:[.,]\d+)?)\s*(млг|мл|гр\.?|г\b|шт|уп(?:\.|аковка)?)?/iu,
  );
  if (!match) return { value: null, unit: null, label: "" };

  const value = Math.max(0, Math.round(Number(match[1].replace(",", "."))));
  const rawUnit = normalizeText(match[2] || "");
  let unit: PriceVolumeUnit = null;

  if (rawUnit.startsWith("мл")) unit = "ml";
  else if (rawUnit === "г" || rawUnit.startsWith("гр")) unit = "g";
  else if (rawUnit.startsWith("шт")) unit = "pcs";
  else if (rawUnit.startsWith("уп")) unit = "pack";

  return {
    value,
    unit,
    label: cleanText(match[0].replace(/^объ[её]м\s*:\s*/iu, "")),
  };
}

function stripVolume(text: string) {
  return cleanText(text.replace(/\s*объ[её]м\s*:.*$/iu, ""));
}

function isFooter(text: string) {
  const normalized = normalizeText(text);
  return (
    /^г\.\s*(?:алматы|астана)/iu.test(normalized) ||
    /^\+?7[\d\s()-]{7,}$/u.test(text.trim())
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

function confidenceFor(volume: ReturnType<typeof parseVolume>) {
  return volume.value !== null ? 95 : 85;
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
      const columnIndex = Math.max(
        0,
        Math.min(2, Math.floor(center / (viewport.width / 3))),
      );
      columns[columnIndex].push(item);
    }

    for (const columnItems of columns) {
      const rows = groupRows(columnItems);
      let card:
        | {
            nameParts: string[];
            bodyRows: string[];
            bodyStarted: boolean;
          }
        | null = null;

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row.text || isFooter(row.text)) continue;

        const priceRow = /цена\s*:/iu.test(row.text);
        const titleRow = row.height >= TITLE_HEIGHT && !priceRow;

        if (!card) {
          if (titleRow) {
            card = {
              nameParts: [row.text],
              bodyRows: [],
              bodyStarted: false,
            };
          }
          continue;
        }

        if (priceRow) {
          let supplementalRow = "";
          const joinedBeforePrice = [...card.nameParts, ...card.bodyRows].join(" ");
          const next = rows[index + 1];
          if (
            !/объ[её]м\s*:/iu.test(joinedBeforePrice) &&
            next &&
            /объ[её]м\s*:/iu.test(next.text)
          ) {
            supplementalRow = next.text;
            index += 1;
          }

          const name = cleanText(card.nameParts.join(" "));
          const combinedText = [
            ...card.nameParts,
            ...card.bodyRows,
            row.text,
            supplementalRow,
          ]
            .filter(Boolean)
            .join(" ");
          const volume = parseVolume(combinedText);
          const prices = parsePrices(row.text, supplementalRow);

          if (name && prices.sourcePrice !== null) {
            const description = cleanText(
              card.bodyRows
                .map(stripVolume)
                .filter(Boolean)
                .join(" "),
            );
            const volumeLabel = volume.label;
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
              supplierSku: syntheticSku(name, volumeLabel),
              originalName: name,
              normalizedName: name,
              description: description || null,
              volumeValue: volume.value,
              volumeUnit: volume.unit,
              volumeLabel,
              sourcePrice: prices.sourcePrice,
              recommendedPrice: prices.recommendedPrice,
              productLineCode: null,
              productLineName: null,
              category: "Без категории",
              sourceDate: null,
              confidence: confidenceFor(volume),
              warnings,
            });
          }

          card = null;
          continue;
        }

        if (titleRow && !card.bodyStarted) {
          card.nameParts.push(row.text);
          continue;
        }

        if (titleRow && card.bodyStarted) {
          card = {
            nameParts: [row.text],
            bodyRows: [],
            bodyStarted: false,
          };
          continue;
        }

        card.bodyStarted = true;
        card.bodyRows.push(row.text);
      }
    }
  }

  if (parsedRows.length === 0) throw new Error("no_price_rows_found");

  return {
    parserId: "JEUDERM_PDF",
    sourceDate: null,
    pageCount: document.numPages,
    rows: parsedRows.sort(
      (a, b) => a.pageNumber - b.pageNumber || a.rowNumber - b.rowNumber,
    ),
    warnings: ["source_date_not_found", "synthetic_skus_generated"],
  };
}
