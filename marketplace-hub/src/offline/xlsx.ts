import * as XLSX from "xlsx";
import type { ImportedRow } from "./importer.js";

export function listWorkbookSheets(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames;
}

export function parseXlsx(
  buffer: Buffer,
  sheetName?: string,
): { sheet: string; rows: ImportedRow[] } {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const selected = sheetName || workbook.SheetNames[0];

  if (!selected || !workbook.Sheets[selected]) {
    throw new Error("Workbook sheet not found");
  }

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[selected],
    {
      defval: "",
      raw: false,
    },
  );

  const rows = data.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.trim(),
        value === null || value === undefined ? "" : String(value).trim(),
      ]),
    ),
  );

  return { sheet: selected, rows };
}
