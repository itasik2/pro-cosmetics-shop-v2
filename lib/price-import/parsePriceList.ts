import { parseAngiopharmPdf } from "./angiopharmPdf";
import { parseGenericPdf } from "./genericPdf";
import { parseJeudermPdf } from "./jeudermPdf";
import { parseMesalteraPdf } from "./mesalteraPdf";
import type { ParsedPriceRow, PriceParseResult, PriceParserMode } from "./types";

function normalizeParserMode(value: unknown): PriceParserMode {
  const mode = String(value || "AUTO").toUpperCase();
  if (mode === "ANGIOPHARM_PDF") return "ANGIOPHARM_PDF";
  if (mode === "MESALTERA_PDF") return "MESALTERA_PDF";
  if (mode === "JEUDERM_PDF") return "JEUDERM_PDF";
  if (mode === "GENERIC_PDF") return "GENERIC_PDF";
  return "AUTO";
}

function normalizeHint(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "");
}

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function isAngiopharmHint(fileName: string, defaultBrand: string) {
  const fileHint = normalizeHint(fileName);
  const brandHint = normalizeHint(defaultBrand);

  return (
    fileHint.includes("angiopharm") ||
    fileHint.includes("ангиофарм") ||
    brandHint === "angiopharm" ||
    brandHint === "ангиофарм"
  );
}

function isMesalteraHint(fileName: string, defaultBrand: string) {
  const fileHint = normalizeHint(fileName);
  const brandHint = normalizeHint(defaultBrand);

  return (
    fileHint.includes("mesaltera") ||
    fileHint.includes("мезальтера") ||
    brandHint === "mesaltera" ||
    brandHint === "мезальтера"
  );
}

function isJeudermHint(fileName: string, defaultBrand: string) {
  const fileHint = normalizeHint(fileName);
  const brandHint = normalizeHint(defaultBrand);

  return (
    fileHint.includes("jeuderm") ||
    fileHint.includes("жеудерм") ||
    brandHint === "jeuderm" ||
    brandHint === "жеудерм"
  );
}

const MESALTERA_CATEGORIES = new Map(
  [
    "Профессиональный уход для всех типов кожи",
    "Солнцезащитные средства",
    "Эксперт-гели для аппаратной косметологии и самостоятельного применения",
    "Уход за проблемной и жирной кожей",
    "Омолаживающий уход",
    "Уход за чувствительной и раздражённой кожей",
    "Уход за сухой обезвоженной кожей",
    "Мультикислотные пилинги",
    "Аксессуары",
  ].map((label) => [normalizeText(label), label]),
);

function sanitizeMesalteraRows(rows: ParsedPriceRow[]) {
  const seen = new Set<string>();
  let currentCategory = "Mesaltera";
  const result: ParsedPriceRow[] = [];

  for (const row of rows) {
    const category = MESALTERA_CATEGORIES.get(normalizeText(row.category));
    if (category) currentCategory = category;

    const key = row.supplierSku || `${normalizeText(row.normalizedName)}::${row.volumeLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      ...row,
      category: currentCategory,
      productLineName: currentCategory,
    });
  }

  return result.map((row, index) => ({ ...row, rowNumber: index + 1 }));
}

function toIsoDate(day: string, month: string, year: string) {
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));

  if (
    date.getUTCFullYear() !== yearNumber ||
    date.getUTCMonth() !== monthNumber - 1 ||
    date.getUTCDate() !== dayNumber
  ) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

function parseDateFromFileName(fileName: string) {
  const separated = fileName.match(
    /(?:^|\D)([0-3]\d)[.\-_ ]([01]\d)[.\-_ ](20\d{2})(?:\D|$)/,
  );
  if (separated) {
    return toIsoDate(separated[1], separated[2], separated[3]);
  }

  const compact = fileName.match(/(?:^|\D)([0-3]\d)([01]\d)(20\d{2})(?:\D|$)/);
  if (compact) {
    return toIsoDate(compact[1], compact[2], compact[3]);
  }

  return null;
}

function withFileNameDate(result: PriceParseResult, fileName: string): PriceParseResult {
  if (result.sourceDate) return result;

  const sourceDate = parseDateFromFileName(fileName);
  if (!sourceDate) return result;

  return {
    ...result,
    sourceDate,
    warnings: [...new Set([...result.warnings, "source_date_from_filename"])],
    rows: result.rows.map((row) => ({ ...row, sourceDate: row.sourceDate || sourceDate })),
  };
}

export async function parsePriceListPdf(input: {
  bytes: Uint8Array;
  fileName: string;
  parserMode?: unknown;
  defaultBrand?: string | null;
}): Promise<PriceParseResult> {
  const parserMode = normalizeParserMode(input.parserMode);
  const defaultBrand = String(input.defaultBrand || "").replace(/\s+/g, " ").trim();
  const angiopharmHint = isAngiopharmHint(input.fileName, defaultBrand);
  const mesalteraHint = isMesalteraHint(input.fileName, defaultBrand);
  const jeudermHint = isJeudermHint(input.fileName, defaultBrand);

  const useAngiopharmParser =
    parserMode === "ANGIOPHARM_PDF" ||
    (angiopharmHint && (parserMode === "AUTO" || !defaultBrand));
  if (useAngiopharmParser) {
    const parsed = await parseAngiopharmPdf(input.bytes);
    const brand = defaultBrand || "ANGIOPHARM";

    return withFileNameDate(
      {
        parserId: "ANGIOPHARM_PDF",
        sourceDate: parsed.sourceDate,
        pageCount: parsed.pageCount,
        warnings: parsed.warnings,
        rows: parsed.rows.map((row) => ({ ...row, brand })),
      },
      input.fileName,
    );
  }

  const useMesalteraParser =
    parserMode === "MESALTERA_PDF" ||
    (mesalteraHint && (parserMode === "AUTO" || !defaultBrand));
  if (useMesalteraParser) {
    const parsed = await parseMesalteraPdf(input.bytes);
    const brand = defaultBrand || "MESALTERA";

    return withFileNameDate(
      {
        ...parsed,
        rows: sanitizeMesalteraRows(
          parsed.rows.map((row) => ({ ...row, brand })),
        ),
      },
      input.fileName,
    );
  }

  const useJeudermParser =
    parserMode === "JEUDERM_PDF" ||
    (jeudermHint && (parserMode === "AUTO" || !defaultBrand));
  if (useJeudermParser) {
    const parsed = await parseJeudermPdf(input.bytes, defaultBrand || "JeuDerm");
    return withFileNameDate(parsed, input.fileName);
  }

  const parsed = await parseGenericPdf({
    bytes: input.bytes,
    defaultBrand,
  });

  return withFileNameDate(parsed, input.fileName);
}

export {
  isAngiopharmHint,
  isJeudermHint,
  isMesalteraHint,
  normalizeParserMode,
};
