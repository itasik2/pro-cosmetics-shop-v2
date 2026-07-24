import { parseAngiopharmPdf } from "./angiopharmPdf";
import { parseGenericPdf } from "./genericPdf";
import type { PriceParseResult, PriceParserMode } from "./types";

function normalizeParserMode(value: unknown): PriceParserMode {
  const mode = String(value || "AUTO").toUpperCase();
  if (mode === "ANGIOPHARM_PDF") return "ANGIOPHARM_PDF";
  if (mode === "GENERIC_PDF") return "GENERIC_PDF";
  return "AUTO";
}

function normalizeHint(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "");
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

  if (
    parserMode === "ANGIOPHARM_PDF" ||
    (parserMode === "AUTO" && isAngiopharmHint(input.fileName, defaultBrand))
  ) {
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

  const parsed = await parseGenericPdf({
    bytes: input.bytes,
    defaultBrand,
  });

  return withFileNameDate(parsed, input.fileName);
}

export { normalizeParserMode };
