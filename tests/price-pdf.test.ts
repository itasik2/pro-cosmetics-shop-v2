import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseTablePages } from "../lib/price-import/tablePdf";
import { parseTekomPages } from "../lib/price-import/tekomPdf";
import type { PdfTablePage } from "../lib/price-import/pdfTableGeometry";
import { validatedLayoutAnalysis } from "../lib/price-import/aiPriceLayout";
import { hasManufacturerSku } from "../lib/enrichment/photoIdentity";
import { calculateSalePrice } from "../lib/price-import/pricing";
import { priceImportFailureMessage } from "../lib/price-import/clientMessages";
import {
  autoVariantGroupKeys,
  parsedProductGroupKey,
} from "../lib/price-import/productVariants";
import { parsePriceListPdf } from "../lib/price-import/parsePriceList";

const filename = "Skinosophy_прайс КОСМЕТОЛОГ 17.07.2026.pdf";
function pages(): PdfTablePage[] {
  return JSON.parse(
    readFileSync("tests/fixtures/skinosophy-table.json", "utf8"),
  );
}
const noAi = async () => {
  throw new Error("recognized table must not require AI");
};

test("Skinosophy ruled cells preserve both prices, complete multiline names and categories", async () => {
  const parsed = (await parseTablePages(
    pages(),
    { fileName: filename },
    noAi,
  ))!;
  assert.equal(parsed.rows.length, 10);
  const row = parsed.rows[0];
  assert.equal(row.brand, "Skinosophy");
  assert.equal(row.supplierSku, "SKY035");
  assert.equal(row.sourcePrice, 7600);
  assert.equal(row.recommendedPrice, 11800);
  assert.equal(
    row.normalizedName,
    "Увлажняющая альгинатная маска с киви, 5х30 г",
  );
  assert.equal(row.category, "Наборы");
  assert.equal(row.volumeValue, 5);
  assert.equal(row.volumeUnit, "pack");
  assert.ok(!row.normalizedName.includes("саше"));
  assert.equal(
    calculateSalePrice({
      ...row,
      priceMode: "PRICE_AS_IS",
      markupPercent: 20,
      roundingStep: 100,
    }),
    11800,
  );
});

test("centered shared names and ingredients map to all SKU variants instead of adjacent products", async () => {
  const parsed = (await parseTablePages(
    pages(),
    { fileName: filename },
    noAi,
  ))!;
  const variants = parsed.rows.filter((row) =>
    ["SKY021", "SKY001", "SKY011"].includes(row.supplierSku!),
  );
  assert.deepEqual(
    variants.map((row) => [
      row.supplierSku,
      row.volumeValue,
      row.volumeUnit,
      row.sourcePrice,
      row.recommendedPrice,
    ]),
    [
      ["SKY021", 30, "g", 1700, 2650],
      ["SKY001", 210, "g", 7500, 10700],
      ["SKY011", 1000, "g", 24200, 33600],
    ],
  );
  assert.equal(new Set(variants.map((row) => row.normalizedName)).size, 1);
  assert.equal(
    variants[0].normalizedName,
    "Антиоксидантная альгинатная маска с клюквой",
  );
  assert.ok(
    variants.every(
      (row) =>
        row.description?.includes("Диатомит") &&
        row.category === "Альгинатные маски для лица",
    ),
  );
  assert.notEqual(
    parsed.rows.find((row) => row.supplierSku === "SKY041")!.normalizedName,
    variants[0].normalizedName,
  );
  const groups = autoVariantGroupKeys(parsed.rows);
  assert.ok(groups.has(parsedProductGroupKey(variants[0])!));
});

test("rows without a manufacturer SKU use stable internal codes, name photo search and explicit missing retail warnings", async () => {
  const first = (await parseTablePages(pages(), { fileName: filename }, noAi))!;
  const second = (await parseTablePages(
    pages(),
    { fileName: "Skinosophy_прайс 01.08.2026.pdf" },
    noAi,
  ))!;
  const accessories = first.rows.filter((row) => row.pageNumber === 13);
  assert.equal(accessories.length, 4);
  assert.ok(
    accessories.every(
      (row) =>
        /^INT-PRICE-[A-F0-9]{12}$/.test(row.supplierSku!) &&
        !hasManufacturerSku(row.supplierSku),
    ),
  );
  assert.deepEqual(
    accessories.map((row) => row.supplierSku),
    second.rows
      .filter((row) => row.pageNumber === 13)
      .map((row) => row.supplierSku),
  );
  const spoon = accessories.find(
    (row) => row.normalizedName === "Мерная ложка",
  )!;
  assert.equal(spoon.sourcePrice, 300);
  assert.equal(spoon.recommendedPrice, null);
  assert.ok(spoon.warnings.includes("recommended_price_missing"));
  assert.ok(accessories.every((row) => row.category === "Аксессуары"));
});

test("AI may identify an unknown table's brand but all prices stay sourced from cells and require review", async () => {
  let calls = 0;
  const parsed = (await parseTablePages(
    pages(),
    { fileName: "supplier-catalog.pdf" },
    async (input) => {
      calls++;
      assert.ok(input.columns.some((column) => column.header.includes("МРЦ")));
      return {
        brand: "Skinosophy",
        brandEvidence: "Skinosophy",
        confidence: 95,
        columns: [],
      };
    },
  ))!;
  assert.equal(calls, 1);
  assert.ok(parsed.warnings.includes("ai_layout_analyzed"));
  assert.equal(parsed.rows[0].sourcePrice, 7600);
  assert.equal(parsed.rows[0].recommendedPrice, 11800);
  assert.ok(
    parsed.rows.every((row) =>
      row.warnings.includes("ai_layout_review_required"),
    ),
  );
});

test("hallucinated AI brands, columns, prices and conflicting price roles are rejected", async () => {
  const request = {
    fileName: "supplier.pdf",
    columns: [
      { id: 0, header: "Наименование" },
      { id: 1, header: "Цена" },
    ],
    evidence: "Skinosophy",
  };
  const valid = {
    brand: "Skinosophy",
    brandEvidence: "Skinosophy",
    confidence: 95,
    columns: [],
  };
  for (const change of [
    { brand: "Other", brandEvidence: "Other" },
    { columns: [{ id: 99, role: "price" }] },
    { sourcePrice: 1 },
    {
      columns: [
        { id: 0, role: "price" },
        { id: 1, role: "price" },
      ],
    },
  ])
    assert.throws(() =>
      validatedLayoutAnalysis({ ...valid, ...change }, request),
    );
  await assert.rejects(
    () =>
      parseTablePages(pages(), { fileName: "unknown.pdf" }, async () => ({
        ...valid,
        columns: [{ id: 5, role: "price" }],
      })),
    /ai_price_layout_conflict/,
  );
  await assert.rejects(
    () =>
      parseTablePages(pages(), { fileName: "unknown.pdf" }, async () => ({
        ...valid,
        confidence: 50,
      })),
    /ai_price_layout_uncertain/,
  );
});

test("ambiguous rows stop the import and provider errors produce actionable messages without response bodies", async () => {
  const broken = pages();
  broken[0].items = broken[0].items.filter(
    (item) => !item.text.includes("Увлажняющая альгинатная маска с киви,"),
  );
  await assert.rejects(
    () => parseTablePages(broken, { fileName: filename }, noAi),
    /pdf_table_row_incomplete/,
  );
  for (const code of [
    "openai_http_429:private-response",
    "openai_http_401:private-response",
    "openai_invalid_json",
  ])
    assert.ok(!priceImportFailureMessage(code).includes("private-response"));
  assert.match(
    priceImportFailureMessage("default_brand_required_or_brand_column_missing"),
    /Бренд по умолчанию/,
  );
});

function samplePdf(sourcePrice = "1200", sourceDate = "") {
  const content = [
    "0.5 w",
    ...(sourceDate ? [`BT /F1 8 Tf 20 190 Td (${sourceDate}) Tj ET`] : []),
    ...[
      [20, 20, 580, 20],
      [20, 100, 580, 100],
      [20, 140, 580, 140],
      [20, 180, 580, 180],
      [20, 20, 20, 180],
      [100, 20, 100, 180],
      [300, 20, 300, 180],
      [400, 20, 400, 180],
      [490, 20, 490, 180],
      [580, 20, 580, 180],
    ].map(([a, b, c, d]) => `${a} ${b} m ${c} ${d} l S`),
    ...[
      [25, 160, "SKU"],
      [110, 160, "Name"],
      [310, 160, "Volume"],
      [405, 160, "Wholesale price"],
      [495, 160, "Retail"],
      [25, 120, "SKY001"],
      [110, 120, "Test cream"],
      [310, 120, "50 ml"],
      [410, 120, sourcePrice],
      [500, 120, "2400"],
    ].map(([x, y, t]) => `BT /F1 8 Tf ${x} ${y} Td (${t}) Tj ET`),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}
test("the real PDF pipeline reads vector rules, preserves a reusable buffer and applies the file's source date", async () => {
  const bytes = samplePdf();
  const parsed = await parsePriceListPdf({
    bytes,
    fileName: filename,
    defaultBrand: "Skinosophy",
  });
  assert.equal(parsed.parserId, "TABLE_PDF");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].sourcePrice, 1200);
  assert.equal(parsed.rows[0].recommendedPrice, 2400);
  assert.equal(parsed.rows[0].volumeValue, 50);
  assert.equal(parsed.sourceDate, "2026-07-17");
  assert.ok(bytes.byteLength > 100);
  await assert.rejects(
    () =>
      parsePriceListPdf({
        bytes: samplePdf("1200 2400"),
        fileName: filename,
        defaultBrand: "Skinosophy",
      }),
    /pdf_table_row_incomplete/,
  );
});

test("ruled PDFs preserve valid document dates on the import and every row without a dated filename", async () => {
  const parsed = await parsePriceListPdf({
    bytes: samplePdf("1200", "Price valid from 31.02.2026 / 17.07.2026"),
    fileName: "supplier-catalog.pdf",
    defaultBrand: "Skinosophy",
  });
  assert.equal(parsed.sourceDate, "2026-07-17");
  assert.ok(parsed.rows.every((row) => row.sourceDate === "2026-07-17"));
  const undated = await parsePriceListPdf({
    bytes: samplePdf("1200", "31.02.2026"),
    fileName: "supplier-catalog.pdf",
    defaultBrand: "Skinosophy",
  });
  assert.equal(undated.sourceDate, null);
});

test("Tekom separates retail and professional prices and recovers merged names from the PDF font", () => {
  const item = (text: string, x: number, top: number, fontName = "plain") =>
    ({ text, x, top, width: 10, height: 8, fontName });
  const priceRow = (top: number, amount: string, cost: string, retail: string) => [
    item(amount, 345, top),
    item(cost, 425, top),
    item(retail, 505, top),
  ];
  const page: PdfTablePage = {
    pageNumber: 1,
    width: 595,
    height: 841,
    vertical: [],
    horizontal: [132, 160, 200, 220].map((top) => ({ x1: 35, x2: 560, top })),
    items: [
      item("sale@tekom.kz", 45, 55),
      item("instagram.com/m.aklive", 45, 65),
      item("объем", 345, 120),
      item("косметолог", 425, 120),
      item("РРЦ", 505, 120),
      item("Пенк% для умы,%н-я «Се/ум к0н120л3»", 45, 149, "damaged"),
      ...priceRow(143, "150 мл", "5070", "8450"),
      ...priceRow(156, "50 мл", "3315", "5525"),
      item("PROFMED", 45, 185),
      item("Лё7к-8 9-л-н7", 45, 214, "damaged"),
      ...priceRow(214, "30 мл", "11050", "—"),
    ],
  };
  const parsed = parseTekomPages([page])!;
  assert.deepEqual(
    parsed.rows.map(({ normalizedName, volumeLabel, sourcePrice, recommendedPrice }) =>
      [normalizedName, volumeLabel, sourcePrice, recommendedPrice]),
    [
      ["Пенка для умывания «Себум контроль»", "150 мл", 5070, 8450],
      ["Пенка для умывания «Себум контроль»", "50 мл", 3315, 5525],
      ["Лёгкий пилинг", "30 мл", 11050, null],
    ],
  );
  assert.ok(parsed.rows[2].warnings.includes("retail_sale_restricted"));
  assert.equal(new Set(parsed.rows.map((row) => row.supplierSku)).size, 3);
});
