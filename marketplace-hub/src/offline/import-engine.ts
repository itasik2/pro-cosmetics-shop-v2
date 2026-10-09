import { z } from "zod";
import { detectImportFormat, type ImportFormat } from "./formats.js";
import { mapRows, mappingSchema, parseCsv, type ImportedRow } from "./importer.js";
import { parseJson, parseXml, parseYaml } from "./structured.js";
import { listWorkbookSheets, parseXlsx } from "./xlsx.js";

export const universalImportSchema = z.object({
  format: z
    .enum(["auto", "csv", "xlsx", "json", "xml", "yml", "yaml"])
    .default("auto"),
  filename: z.string().optional(),
  contentType: z.string().optional(),
  text: z.string().optional(),
  base64: z.string().optional(),
  delimiter: z.string().length(1).default(";"),
  sheet: z.string().trim().min(1).optional(),
  collectionPath: z.string().trim().min(1).optional(),
  mapping: mappingSchema,
});

export type UniversalImportInput = z.input<typeof universalImportSchema>;

export function previewUniversalImport(raw: UniversalImportInput) {
  const input = universalImportSchema.parse(raw);

  if (!input.text && !input.base64) {
    throw new Error("Provide text or base64 catalog content");
  }

  const format: Exclude<ImportFormat, "auto"> =
    input.format === "auto"
      ? detectImportFormat({
          filename: input.filename,
          contentType: input.contentType,
          text: input.text,
        })
      : input.format;

  let rows: ImportedRow[];
  let metadata: Record<string, unknown> = { format };

  if (format === "xlsx") {
    if (!input.base64) throw new Error("XLSX import requires base64 content");
    const buffer = Buffer.from(input.base64, "base64");
    const sheets = listWorkbookSheets(buffer);
    const workbook = parseXlsx(buffer, input.sheet);
    rows = workbook.rows;
    metadata = {
      format,
      sheets,
      selectedSheet: workbook.sheet,
    };
  } else {
    const text =
      input.text ??
      (input.base64
        ? Buffer.from(input.base64, "base64").toString("utf8")
        : "");

    if (format === "csv") {
      rows = parseCsv(text, input.delimiter);
      metadata = { format, delimiter: input.delimiter };
    } else if (format === "json") {
      rows = parseJson(text, input.collectionPath);
      metadata = { format, collectionPath: input.collectionPath ?? null };
    } else if (format === "xml") {
      rows = parseXml(text, input.collectionPath);
      metadata = { format, collectionPath: input.collectionPath ?? null };
    } else {
      rows = parseYaml(text, input.collectionPath);
      metadata = { format, collectionPath: input.collectionPath ?? null };
    }
  }

  const mapped = mapRows(rows, input.mapping);

  return {
    ...metadata,
    format,
    rows: mapped.length,
    validRows: mapped.filter((row) => row.valid).length,
    invalidRows: mapped.filter((row) => !row.valid).length,
    columns: Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).sort(),
    data: mapped,
  };
}
