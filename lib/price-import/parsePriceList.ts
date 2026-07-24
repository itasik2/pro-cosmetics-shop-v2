import { parseAngiopharmPdf } from "./angiopharmPdf";
import { parseGenericPdf } from "./genericPdf";
import type { PriceParseResult, PriceParserMode } from "./types";

function normalizeParserMode(value: unknown): PriceParserMode {
  const mode = String(value || "AUTO").toUpperCase();
  if (mode === "ANGIOPHARM_PDF") return "ANGIOPHARM_PDF";
  if (mode === "GENERIC_PDF") return "GENERIC_PDF";
  return "AUTO";
}

function isAngiopharmHint(fileName: string, defaultBrand: string) {
  return /angiopharm/i.test(fileName) || /^angiopharm$/i.test(defaultBrand.trim());
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

    return {
      parserId: "ANGIOPHARM_PDF",
      sourceDate: parsed.sourceDate,
      pageCount: parsed.pageCount,
      warnings: parsed.warnings,
      rows: parsed.rows.map((row) => ({ ...row, brand })),
    };
  }

  return parseGenericPdf({
    bytes: input.bytes,
    defaultBrand,
  });
}

export { normalizeParserMode };
