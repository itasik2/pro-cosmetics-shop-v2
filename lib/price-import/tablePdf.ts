import { createHash } from "node:crypto";
import {
  analyzePriceTableLayout,
  validatedLayoutAnalysis,
  type LayoutAnalyzer,
  type TableRole,
} from "./aiPriceLayout";
import {
  readTablePages,
  type PdfTablePage,
  type PdfTableItem,
} from "./pdfTableGeometry";
import type {
  ParsedPriceRow,
  PriceParseResult,
  PriceVolumeUnit,
} from "./types";

type Column = { start: number; end: number; role: TableRole; header: string };
type Layout = { columns: Column[]; top: number; width: number };
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
function unique(values: number[]) {
  return values
    .sort((a, b) => a - b)
    .filter((v, i, a) => !i || v - a[i - 1] > 1);
}
function text(items: PdfTableItem[]) {
  return clean(
    [...items]
      .sort((a, b) => (Math.abs(a.top - b.top) < 2 ? a.x - b.x : a.top - b.top))
      .map((item) => item.text)
      .join(" "),
  );
}
function center(item: PdfTableItem) {
  return item.top - item.height / 2;
}
function boundaries(page: PdfTablePage, x: number) {
  return unique(
    page.horizontal
      .filter((rule) => rule.x1 <= x + 1 && rule.x2 >= x - 1)
      .map((rule) => rule.top),
  );
}
function rowBounds(page: PdfTablePage, x: number, y: number) {
  const rules = boundaries(page, x);
  const top = rules.filter((v) => v < y - 0.5).at(-1);
  const bottom = rules.find((v) => v > y + 0.5);
  return top === undefined || bottom === undefined ? null : { top, bottom };
}
function cell(page: PdfTablePage, column: Column, y: number) {
  const bounds = rowBounds(page, (column.start + column.end) / 2, y);
  return bounds
    ? text(
        page.items.filter(
          (item) =>
            item.x >= column.start - 0.5 &&
            item.x < column.end - 0.5 &&
            center(item) > bounds.top + 0.2 &&
            center(item) < bounds.bottom - 0.2,
        ),
      )
    : "";
}
function role(header: string): TableRole {
  const v = header.toLowerCase().replace(/ё/g, "е");
  if (/мрц|ррц|рознич|рекоменд|retail|rrp/.test(v)) return "recommended";
  if (/ингредиент|состав|описание|ingredients|description/.test(v))
    return "description";
  if (/наименован|название|product|^name$/.test(v)) return "name";
  if (/артикул|^sku$|код товара/.test(v)) return "sku";
  if (/объем|фасовк|размер|volume|size/.test(v)) return "volume";
  if (/бренд|brand|производитель/.test(v)) return "brand";
  if (/цен|стоим|опт|wholesale|price|cost/.test(v)) return "price";
  return "ignore";
}
function headerLayout(page: PdfTablePage): Layout | null {
  const anchor = page.items.find((item) =>
    /^(?:наименование|название|name|product name)$/iu.test(item.text),
  );
  if (!anchor) return null;
  const y = center(anchor);
  const edges = unique(
    page.vertical
      .filter((rule) => rule.top < y && rule.bottom > y)
      .map((rule) => rule.x),
  );
  if (edges.length < 4 || edges.length > 20) return null;
  const bounds = rowBounds(page, anchor.x + anchor.width / 2, y);
  if (!bounds) return null;
  const columns = edges.slice(0, -1).map((start, i) => {
    const column = {
      start,
      end: edges[i + 1],
      role: "ignore" as TableRole,
      header: "",
    };
    column.header = cell(page, column, y);
    column.role = role(column.header);
    return column;
  });
  return { columns, top: bounds.bottom, width: page.width };
}
function money(value: string) {
  const amount = value
    .replace(/(?:₸|тг\.?|kzt)/giu, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!/^(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d{1,2})?$/u.test(amount))
    return null;
  const result = Number(amount.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(result) && result > 0 && result <= 2_000_000_000
    ? Math.round(result)
    : null;
}
function volume(label: string): {
  value: number | null;
  unit: PriceVolumeUnit;
  label: string;
} {
  const match = label.match(
    /(\d+(?:[.,]\d+)?)\s*(кг|kg|мл|ml|гр\.?|г|g|л|l|шт\.?)(?=$|[^\p{L}])/iu,
  );
  if (!match) return { value: null, unit: null, label };
  const n = Number(match[1].replace(",", ".")),
    unit = match[2].toLowerCase();
  if (/^шт/.test(unit))
    return {
      value: Math.round(n),
      unit: /набор|комплект|коробка|упак/iu.test(label) ? "pack" : "pcs",
      label,
    };
  return {
    value: Math.round(n * (/^(?:кг|kg|л|l)$/.test(unit) ? 1000 : 1)),
    unit: /^(?:кг|kg|гр\.?|г|g)$/.test(unit) ? "g" : "ml",
    label,
  };
}
function categoryAt(
  page: PdfTablePage,
  layout: Layout,
  y: number,
  previous: string,
) {
  const start = layout.columns[0].start,
    end = layout.columns.at(-1)!.end;
  const candidates = page.items.filter(
    (item) =>
      center(item) > layout.top &&
      center(item) < y &&
      item.text.length > 2 &&
      item.text.length < 120,
  );
  const categories = new Map<string, string>();
  for (const item of candidates) {
    const at = center(item);
    if (
      page.vertical.some(
        (rule) =>
          rule.x > start + 3 &&
          rule.x < end - 3 &&
          rule.top < at - 1 &&
          rule.bottom > at + 1,
      )
    )
      continue;
    const bounds = rowBounds(page, (start + end) / 2, at);
    if (!bounds) continue;
    const label = text(
      page.items.filter(
        (other) =>
          center(other) > bounds.top + 0.2 &&
          center(other) < bounds.bottom - 0.2,
      ),
    );
    if (
      label &&
      label.length < 120 &&
      !/\d{3}|@|наименование|артикул/iu.test(label)
    )
      categories.set(String(bounds.top), label);
  }
  return [...categories.values()].at(-1) || previous;
}
export async function parseTablePages(
  pages: PdfTablePage[],
  input: { fileName: string; defaultBrand?: string | null },
  analyzer: LayoutAnalyzer = analyzePriceTableLayout,
): Promise<PriceParseResult | null> {
  const first = pages
    .map((page) => ({ page, layout: headerLayout(page) }))
    .find((value) => value.layout);
  if (!first?.layout) return null;
  let layout = first.layout;
  let brand = clean(input.defaultBrand || "");
  const evidence = pages
    .slice(0, 2)
    .flatMap((page) => page.items)
    .slice(0, 160)
    .map((item) => item.text)
    .join("\n");
  if (
    !brand &&
    /^skinosophy(?:[\s_.-]|$)/iu.test(input.fileName) &&
    /skinosophy/iu.test(evidence)
  )
    brand = "Skinosophy";
  let ai = false;
  if (
    (!brand && !layout.columns.some((column) => column.role === "brand")) ||
    (!layout.columns.some((column) => column.role === "sku") &&
      layout.columns.some(
        (column) => column.role === "ignore" && column.header,
      )) ||
    !["name", "price"].every((key) =>
      layout.columns.some((column) => column.role === key),
    )
  ) {
    const request = {
      fileName: input.fileName,
      columns: layout.columns.map((column, id) => ({
        id,
        header: column.header,
      })),
      evidence: evidence.slice(0, 14000),
    };
    const analysis = validatedLayoutAnalysis(await analyzer(request), request);
    if (analysis.confidence < 85) throw new Error("ai_price_layout_uncertain");
    for (const entry of analysis.columns) {
      const column = layout.columns[entry.id];
      // Clearly labelled source amounts must never be swapped by the model.
      if (column.role !== "ignore" && column.role !== entry.role)
        throw new Error("ai_price_layout_conflict");
      column.role = entry.role;
    }
    brand = brand || clean(analysis.brand || "");
    ai = true;
  }
  if (
    !["name", "price"].every((key) =>
      layout.columns.some((column) => column.role === key),
    )
  )
    throw new Error("ai_price_layout_invalid");
  const assignedRoles = layout.columns
    .filter((column) => column.role !== "ignore")
    .map((column) => column.role);
  if (new Set(assignedRoles).size !== assignedRoles.length)
    throw new Error("pdf_table_layout_ambiguous");
  if (!brand && !layout.columns.some((column) => column.role === "brand"))
    throw new Error("default_brand_required_or_brand_column_missing");
  const rows: ParsedPriceRow[] = [];
  let category = "Без категории";
  const warnings = ai ? ["ai_layout_analyzed"] : [];
  for (const page of pages.filter(
    (page) => page.pageNumber >= first.page.pageNumber,
  )) {
    const fresh = headerLayout(page);
    if (fresh) {
      if (
        fresh.columns.length !== layout.columns.length ||
        fresh.columns.some(
          (column, i) =>
            column.role !== "ignore" && column.role !== layout.columns[i].role,
        )
      )
        throw new Error("pdf_table_layout_changed");
      layout = {
        ...fresh,
        columns: fresh.columns.map((column, i) => ({
          ...column,
          role: layout.columns[i].role,
        })),
      };
    } else {
      const scale = page.width / layout.width;
      layout = {
        width: page.width,
        top: 0,
        columns: layout.columns.map((column) => ({
          ...column,
          start: column.start * scale,
          end: column.end * scale,
        })),
      };
    }
    const priceColumn = layout.columns.find(
      (column) => column.role === "price",
    )!;
    const read = (key: TableRole, y: number) => {
      const column = layout.columns.find((column) => column.role === key);
      return column ? cell(page, column, y) : "";
    };
    const anchors = new Map<string, number>();
    for (const item of page.items) {
      const y = center(item);
      if (
        y <= layout.top ||
        item.x < priceColumn.start ||
        item.x >= priceColumn.end
      )
        continue;
      if (
        ![priceColumn.start, priceColumn.end].every((x) =>
          page.vertical.some(
            (rule) =>
              Math.abs(rule.x - x) < 2 && rule.top < y && rule.bottom > y,
          ),
        )
      )
        continue;
      if (
        !layout.columns.every((column) =>
          page.vertical.some(
            (rule) =>
              Math.abs(rule.x - column.start) < 2 &&
              rule.top < y &&
              rule.bottom > y,
          ),
        )
      )
        throw new Error("pdf_table_layout_changed");
      const amount = cell(page, priceColumn, y);
      if (/\d/.test(amount) && money(amount) === null)
        throw new Error("pdf_table_row_incomplete");
      const bounds = rowBounds(
        page,
        (priceColumn.start + priceColumn.end) / 2,
        y,
      );
      if (bounds && money(cell(page, priceColumn, y)) !== null)
        anchors.set(String(bounds.top), y);
    }
    for (const y of [...anchors.values()].sort((a, b) => a - b)) {
      const name = read("name", y),
        sourcePrice = money(read("price", y));
      if (
        !name ||
        (name.match(/\p{L}/gu)?.length || 0) < 3 ||
        sourcePrice === null
      )
        throw new Error("pdf_table_row_incomplete");
      const rowBrand = read("brand", y) || brand;
      if (!rowBrand)
        throw new Error("default_brand_required_or_brand_column_missing");
      const size = volume(read("volume", y));
      const rawSku = read("sku", y).replace(/\s+/g, "").toUpperCase();
      if (rawSku && !/^[\p{L}\p{N}][\p{L}\p{N}._/-]{1,79}$/u.test(rawSku))
        throw new Error("pdf_table_sku_invalid");
      const supplierSku =
        rawSku ||
        "INT-PRICE-" +
          createHash("sha256")
            .update(
              [
                rowBrand.toLowerCase(),
                name.toLowerCase(),
                size.label.toLowerCase(),
              ].join("::"),
            )
            .digest("hex")
            .slice(0, 12)
            .toUpperCase();
      const recommendedText = read("recommended", y),
        recommendedPrice = money(recommendedText);
      category = categoryAt(page, layout, y, category);
      const rowWarnings = [
        ...(rawSku ? [] : ["synthetic_sku_generated"]),
        ...(ai ? ["ai_layout_review_required"] : []),
      ];
      if (
        layout.columns.some((column) => column.role === "recommended") &&
        recommendedPrice === null
      )
        rowWarnings.push("recommended_price_missing");
      if (/не\s*прода|только.*проф|not.*sale/iu.test(recommendedText))
        rowWarnings.push("retail_sale_restricted");
      rows.push({
        pageNumber: page.pageNumber,
        rowNumber: rows.length + 1,
        brand: rowBrand,
        supplierSku,
        originalName: name,
        normalizedName: name.replace(/\s+NEW\s*$/u, "").trim(),
        description: read("description", y) || null,
        volumeValue: size.value,
        volumeUnit: size.unit,
        volumeLabel: size.label,
        sourcePrice,
        recommendedPrice,
        productLineCode: null,
        productLineName: null,
        category,
        sourceDate: null,
        confidence: ai ? 80 : 95,
        warnings: rowWarnings,
      });
    }
  }
  if (!rows.length) return null;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.brand + "::" + row.supplierSku;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const row of rows)
    if ((counts.get(row.brand + "::" + row.supplierSku) || 0) > 1) {
      row.warnings.push("duplicate_sku_in_file");
      row.confidence = Math.min(60, row.confidence);
    }
  return {
    parserId: "TABLE_PDF",
    sourceDate: null,
    pageCount: pages.length,
    rows,
    warnings,
  };
}
export async function parseTablePdf(
  input: { bytes: Uint8Array; fileName: string; defaultBrand?: string | null },
  analyzer?: LayoutAnalyzer,
) {
  return parseTablePages(await readTablePages(input.bytes), input, analyzer);
}
