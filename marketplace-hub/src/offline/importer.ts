import { z } from "zod";

export type ImportedRow = Record<string, string>;

export type ColumnMapping = {
  sku: string;
  title: string;
  brand?: string;
  barcode?: string;
  description?: string;
  price?: string;
  stock?: string;
};

export const mappingSchema = z.object({
  sku: z.string().trim().min(1),
  title: z.string().trim().min(1),
  brand: z.string().trim().min(1).optional(),
  barcode: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  price: z.string().trim().min(1).optional(),
  stock: z.string().trim().min(1).optional(),
});

function splitCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(value);
      value = "";
      continue;
    }

    value += char;
  }

  cells.push(value);
  return cells.map((cell) => cell.trim());
}

export function parseCsv(text: string, delimiter = ";"): ImportedRow[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function parseInteger(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return undefined;
  return Math.round(number);
}

export function mapRows(rows: ImportedRow[], mapping: ColumnMapping) {
  const validMapping = mappingSchema.parse(mapping);

  return rows.map((row, index) => {
    const sku = row[validMapping.sku]?.trim();
    const title = row[validMapping.title]?.trim();

    const errors: string[] = [];
    if (!sku) errors.push("SKU is empty");
    if (!title) errors.push("Title is empty");

    return {
      row: index + 2,
      valid: errors.length === 0,
      errors,
      product: {
        sku: sku ?? "",
        title: title ?? "",
        brand: validMapping.brand ? row[validMapping.brand]?.trim() || undefined : undefined,
        barcode: validMapping.barcode ? row[validMapping.barcode]?.trim() || undefined : undefined,
        description: validMapping.description ? row[validMapping.description]?.trim() || undefined : undefined,
        price: validMapping.price ? parseInteger(row[validMapping.price]) : undefined,
        stock: validMapping.stock ? parseInteger(row[validMapping.stock]) : undefined,
      },
    };
  });
}
