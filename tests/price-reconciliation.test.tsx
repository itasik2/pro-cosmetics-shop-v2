import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { applyPriceImport } from "../lib/price-import/applyImport";
import {
  readPriceImport,
  preparePriceImport,
} from "../lib/price-import/reconciliation";
import {
  dateBlock,
  decidePriceRow,
  missingPricePositions,
  sourceDay,
  priceToday,
} from "../lib/price-import/reconciliationPolicy";
import PriceImportSummary from "../app/admin/(private)/price-imports/PriceImportSummary";

const oldDate = new Date("2020-01-01T00:00:00Z");
const newDate = new Date("2020-02-01T00:00:00Z");
const parsed = (sku = "SKU1", salePrice = 1200, volume = 50) => ({
  pageNumber: 1,
  rowNumber: 1,
  brand: "Brand",
  supplierSku: sku,
  originalName: `Крем, ${volume} мл`,
  normalizedName: "Крем",
  description: "Текст из прайса",
  volumeValue: volume,
  volumeUnit: "ml",
  volumeLabel: `${volume} мл`,
  sourcePrice: salePrice,
  salePrice,
  productLineCode: null,
  productLineName: null,
  category: "Уход",
  sourceDate: "2020-02-01",
  confidence: 95,
  warnings: [],
});
const product = () => ({
  id: "p",
  name: "Крем",
  supplierId: "supplier",
  supplierSku: "SKU1",
  brandId: "brand",
  brand: { name: "Brand" },
  price: 1000,
  sourcePrice: 700,
  priceListDate: oldDate,
  stock: 7,
  variants: null as any,
  updatedAt: oldDate,
  volumeValue: 50,
  volumeUnit: "ml",
  image: "/own-photo.jpg",
  description: "Проверенное описание",
  isPublished: true,
  isNew: false,
  enrichmentStatus: "READY",
  category: "Уход",
});
const row = (sku = "SKU1", price = 1200, id = "row") => ({
  id,
  importId: "new",
  productId: "p" as string | null,
  supplierSku: sku,
  action: "UPDATE",
  confidence: 95,
  selected: true,
  parsedData: parsed(sku, price),
  rawData: {},
  appliedAt: null as Date | null,
  rowNumber: 1,
  pageNumber: 1,
  error: null as string | null,
});

function fixture() {
  let state = {
    products: [product()],
    rows: [row()],
    histories: [] as any[],
    imports: [
      {
        id: "new",
        supplierId: "supplier",
        fileName: "new.pdf",
        sourceDate: newDate,
        status: "REVIEW",
        priceMode: "PRICE_AS_IS",
        createdAt: new Date("2026-01-01"),
        appliedAt: null,
        createdRows: 0,
        updatedRows: 0,
        skippedRows: 0,
        errorRows: 0,
      },
      {
        id: "old",
        supplierId: "supplier",
        fileName: "old.pdf",
        sourceDate: oldDate,
        status: "APPLIED",
        priceMode: "PRICE_AS_IS",
        createdAt: oldDate,
        appliedAt: oldDate,
        createdRows: 0,
        updatedRows: 1,
        skippedRows: 0,
        errorRows: 0,
      },
    ] as any[],
    previousRows: [
      {
        ...row(),
        id: "old-row",
        importId: "old",
        parsedData: parsed("SKU1", 1000),
        appliedAt: oldDate,
      },
    ],
  };
  const flags = {
    beforeTransaction: null as null | (() => void),
    failRow: false,
    brandWrites: 0,
  };
  let clock = 1;
  function db(get: () => typeof state): any {
    function rowsFor(importId: string) {
      return [...get().rows, ...get().previousRows].filter(
        (item) => item.importId === importId,
      );
    }
    function importWithRows(item: any, args: any) {
      if (!item) return null;
      const filter = args.include?.rows?.where;
      const rows = rowsFor(item.id).filter(
        (row) =>
          (!filter ||
            filter.selected === undefined ||
            row.selected === filter.selected) &&
          (!filter || filter.appliedAt !== null || !row.appliedAt),
      );
      return structuredClone({
        ...item,
        supplier: { id: "supplier", name: "Поставщик" },
        rows,
      });
    }
    const api: any = {
      priceImport: {
        findUnique: async (args: any) =>
          importWithRows(
            get().imports.find((item) => item.id === args.where.id),
            args,
          ),
        findFirst: async (args: any) => {
          const w = args.where;
          const items = get().imports.filter(
            (item) =>
              item.supplierId === w.supplierId &&
              item.id !== w.id?.not &&
              (!w.status ||
                (typeof w.status === "string"
                  ? item.status === w.status
                  : w.status.in.includes(item.status))) &&
              (!w.sourceDate ||
                (item.sourceDate &&
                  (!w.sourceDate.lte ||
                    +item.sourceDate <= +w.sourceDate.lte))) &&
              (!w.OR ||
                item.status === "APPLIED" ||
                rowsFor(item.id).some((row) => row.appliedAt)),
          );
          items.sort((a, b) => +(b.sourceDate || 0) - +(a.sourceDate || 0));
          return importWithRows(items[0], args);
        },
        update: async ({ where, data }: any) => {
          const item = get().imports.find((item) => item.id === where.id)!;
          Object.assign(item, structuredClone(data));
          return structuredClone(item);
        },
      },
      priceImportRow: {
        findUniqueOrThrow: async ({ where }: any) =>
          structuredClone(get().rows.find((row) => row.id === where.id)!),
        findMany: async ({ where }: any) =>
          structuredClone(rowsFor(where.importId)),
        update: async ({ where, data }: any) => {
          if (flags.failRow && data.appliedAt)
            throw new Error("row_write_failed");
          const item = get().rows.find((row) => row.id === where.id)!;
          Object.assign(item, structuredClone(data));
          return structuredClone(item);
        },
        updateMany: async ({ where, data }: any) => {
          const items = get().rows.filter(
            (row) =>
              (!where.importId || row.importId === where.importId) &&
              (!where.id ||
                (typeof where.id === "string"
                  ? row.id === where.id
                  : where.id.in.includes(row.id))) &&
              (where.appliedAt !== null || !row.appliedAt),
          );
          for (const item of items) Object.assign(item, structuredClone(data));
          return { count: items.length };
        },
      },
      product: {
        findMany: async ({ where }: any) =>
          structuredClone(
            get().products.filter(
              (p) =>
                p.supplierId === where.supplierId &&
                p.enrichmentStatus !== "MERGED",
            ),
          ),
        findUnique: async ({ where }: any) =>
          structuredClone(
            get().products.find((p) => p.id === where.id) || null,
          ),
        update: async ({ where, data }: any) => {
          const item = get().products.find((p) => p.id === where.id)!;
          if (where.updatedAt && +where.updatedAt !== +item.updatedAt)
            throw Object.assign(new Error("race"), { code: "P2025" });
          Object.assign(item, structuredClone(data), {
            updatedAt: new Date(+newDate + clock++),
          });
          return structuredClone(item);
        },
        create: async ({ data }: any) => {
          const item = {
            ...product(),
            ...structuredClone(data),
            id: `created-${clock++}`,
            updatedAt: newDate,
          };
          get().products.push(item);
          return structuredClone(item);
        },
      },
      brand: {
        findFirst: async () => ({ id: "brand", name: "Brand" }),
        update: async () => {
          flags.brandWrites++;
          return {};
        },
      },
      productEnrichmentProposal: { findMany: async () => [] },
      productPriceHistory: {
        create: async ({ data }: any) => {
          get().histories.push(structuredClone(data));
          return data;
        },
      },
      $transaction: async (callback: any) => {
        if (flags.beforeTransaction) {
          const action = flags.beforeTransaction;
          flags.beforeTransaction = null;
          action();
        }
        const draft = structuredClone(get());
        const result = await callback(db(() => draft));
        state = draft;
        return result;
      },
    };
    return api;
  }
  return {
    database: db(() => state),
    flags,
    get state() {
      return state;
    },
    dependencies: {
      database: db(() => state),
      makeSlug: async ({ value }: any) => value,
    } as any,
  };
}

test("fresh price-only increases apply automatically once and keep content, stock, photos and publication", async () => {
  const f = fixture(),
    before = structuredClone(f.state.products[0]);
  const result = await applyPriceImport(
    { importId: "new", automatic: true },
    f.dependencies,
  );
  assert.equal(f.state.products[0].price, 1200);
  for (const key of [
    "stock",
    "image",
    "description",
    "isPublished",
    "isNew",
    "supplierSku",
  ] as const)
    assert.equal(f.state.products[0][key], before[key]);
  assert.equal(f.flags.brandWrites, 0);
  assert.equal(result.import?.reconciliation.automaticApplied, 1);
  assert.ok(f.state.rows[0].appliedAt);
  assert.equal(f.state.histories.length, 1);
  await applyPriceImport({ importId: "new", automatic: true }, f.dependencies);
  assert.equal(f.state.histories.length, 1);
});

test("lower prices wait for exact admin approval and repeat requests cannot apply them twice", async () => {
  const f = fixture();
  f.state.rows[0].parsedData.salePrice = 800;
  await preparePriceImport("new", f.database);
  assert.equal(f.state.rows[0].selected, false);
  await applyPriceImport({ importId: "new", automatic: true }, f.dependencies);
  assert.equal(f.state.products[0].price, 1000);
  f.state.rows[0].selected = true;
  await applyPriceImport({ importId: "new" }, f.dependencies);
  assert.equal(f.state.products[0].price, 1000);
  assert.equal(f.state.rows[0].appliedAt, null);
  f.state.rows[0].selected = true;
  await applyPriceImport(
    {
      importId: "new",
      approvedDecreases: [
        { rowId: "row", previousPrice: 1000, nextPrice: 800 },
      ],
    },
    f.dependencies,
  );
  assert.equal(f.state.products[0].price, 800);
  assert.equal(f.state.histories.length, 1);
});

test("a price changing after review invalidates a decrease approval", async () => {
  const f = fixture();
  f.state.rows[0].parsedData.salePrice = 800;
  f.flags.beforeTransaction = () => {
    f.state.products[0].price = 900;
  };
  await applyPriceImport(
    {
      importId: "new",
      approvedDecreases: [
        { rowId: "row", previousPrice: 1000, nextPrice: 800 },
      ],
    },
    f.dependencies,
  );
  assert.equal(f.state.products[0].price, 900);
  assert.equal(f.state.rows[0].appliedAt, null);
  assert.match(f.state.rows[0].error!, /не подтверждено/);
  assert.equal(f.state.histories.length, 0);
});

test("old, undated and future price lists cannot overwrite prices even through manual apply", async () => {
  for (const [date, error] of [
    [new Date("2019-01-01"), "price_import_older"],
    [null, "price_import_date_required"],
    [new Date("2099-01-01"), "price_import_future"],
  ] as const) {
    const f = fixture();
    f.state.imports[0].sourceDate = date;
    await assert.rejects(
      applyPriceImport({ importId: "new" }, f.dependencies),
      new RegExp(error),
    );
    assert.equal(f.state.products[0].price, 1000);
    assert.equal(f.state.histories.length, 0);
  }
});

test("a newer reviewed price list also prevents rollback from an older file", async () => {
  const f = fixture();
  f.state.imports.push({
    ...f.state.imports[0],
    id: "newer",
    sourceDate: new Date("2020-03-01"),
    status: "REVIEW",
  });
  await assert.rejects(
    applyPriceImport({ importId: "new", automatic: true }, f.dependencies),
    /price_import_older/,
  );
  assert.equal(f.state.products[0].price, 1000);
});

test("both variant SKU prices update independently without replacing sibling images or stock", async () => {
  const f = fixture();
  f.state.products[0].variants = [
    { id: "small", sku: "SKU1", label: "50 мл", price: 1000, stock: 3 },
    {
      id: "large",
      sku: "SKU2",
      label: "100 мл",
      price: 5000,
      stock: 4,
      image: "/large.jpg",
    },
  ];
  f.state.rows.push({
    ...row("SKU2", 6000, "row2"),
    parsedData: parsed("SKU2", 6000, 100),
  });
  f.state.previousRows.push({
    ...row("SKU2", 5000, "old-row2"),
    importId: "old",
    parsedData: parsed("SKU2", 5000, 100),
    appliedAt: oldDate,
  });
  const result = await applyPriceImport(
    { importId: "new", automatic: true },
    f.dependencies,
  );
  assert.equal(result.import?.reconciliation.automaticApplied, 2);
  assert.equal(f.state.products[0].variants[0].price, 1200);
  assert.equal(f.state.products[0].variants[1].price, 6000);
  assert.equal(f.state.products[0].variants[1].image, "/large.jpg");
  assert.equal(f.state.products[0].variants[0].stock, 3);
  assert.equal(f.state.products[0].variants[1].stock, 4);
  assert.equal(f.state.products[0].price, 1200);
  assert.equal(f.state.products[0].stock, 7);
});

test("a cheaper non-minimum variant requires approval for its own price, not the parent minimum", async () => {
  const f = fixture();
  f.state.products[0].variants = [
    { id: "small", sku: "SKU1", label: "50 мл", price: 1000, stock: 3 },
    { id: "large", sku: "SKU2", label: "100 мл", price: 5000, stock: 4 },
  ];
  f.state.rows = [
    { ...row("SKU2", 4000), parsedData: parsed("SKU2", 4000, 100) },
  ];
  await applyPriceImport({ importId: "new" }, f.dependencies);
  assert.equal(f.state.products[0].variants[1].price, 5000);
  f.state.rows[0].selected = true;
  await applyPriceImport(
    {
      importId: "new",
      approvedDecreases: [
        { rowId: "row", previousPrice: 5000, nextPrice: 4000 },
      ],
    },
    f.dependencies,
  );
  assert.equal(f.state.products[0].variants[1].price, 4000);
  assert.equal(f.state.products[0].price, 1000);
});

test("missing items remain published with local inventory and are reported to the administrator", async () => {
  const f = fixture();
  f.state.rows = [];
  const before = structuredClone(f.state.products[0]);
  const result = await readPriceImport("new", f.database);
  assert.equal(result?.reconciliation.missing.length, 1);
  assert.equal(result?.reconciliation.missing[0].stock, 7);
  assert.deepEqual(f.state.products[0], before);
  const html = renderToStaticMarkup(
    <PriceImportSummary report={result!.reconciliation} />,
  );
  assert.match(html, /SKU1/);
  assert.match(html, /7 шт\./);
  assert.match(html, /публикация не изменены/);
});

test("an unchecked or manual-review SKU is present in the file and is not reported as missing", () => {
  const p = product();
  p.variants = [
    { id: "a", sku: "SKU1", label: "50 мл", price: 1000, stock: 2 },
    { id: "b", sku: "SKU2", label: "100 мл", price: 2000, stock: 5 },
  ];
  const missing = missingPricePositions(
    [p],
    [{ ...row("SKU1"), selected: false, action: "MANUAL_REVIEW" }],
  );
  assert.deepEqual(
    missing.map((p) => [p.sku, p.stock]),
    [["SKU2", 5]],
  );
});

test("new SKUs are offered for review and created only as unpublished zero-stock new arrivals", async () => {
  const f = fixture();
  f.state.rows = [{ ...row("NEW", 3000), productId: null, action: "CREATE" }];
  await applyPriceImport({ importId: "new", automatic: true }, f.dependencies);
  assert.equal(f.state.products.length, 1);
  await applyPriceImport({ importId: "new" }, f.dependencies);
  const created = f.state.products.find((p) => p.supplierSku === "NEW")!;
  assert.equal(created.isNew, true);
  assert.equal(created.isPublished, false);
  assert.equal(created.stock, 0);
  assert.equal(f.state.products[0].stock, 7);
});

test("a new variant still groups with a row already auto-applied and preserves the original local stock", async () => {
  const f = fixture();
  f.state.rows.push({
    ...row("SKU2", 3000, "row2"),
    parsedData: parsed("SKU2", 3000, 100),
  });
  await applyPriceImport({ importId: "new", automatic: true }, f.dependencies);
  assert.ok(f.state.rows[0].appliedAt);
  assert.equal(f.state.rows[1].appliedAt, null);
  await applyPriceImport({ importId: "new" }, f.dependencies);
  const p = f.state.products[0];
  assert.equal(p.variants.length, 2);
  assert.equal(p.variants.find((v: any) => v.sku === "SKU1").stock, 7);
  assert.equal(
    p.variants.find((v: any) => v.sku === "SKU1").image,
    "/own-photo.jpg",
  );
  assert.equal(p.variants.find((v: any) => v.sku === "SKU2").stock, 0);
  assert.equal(p.isNew, true);
  assert.equal(p.stock, 7);
});

test("source-only imports update purchasing prices and require approval for purchasing-price decreases", async () => {
  const f = fixture();
  f.state.imports[0].priceMode = "SOURCE_ONLY";
  f.state.imports[1].priceMode = "SOURCE_ONLY";
  f.state.rows[0].parsedData.sourcePrice = 900;
  await applyPriceImport({ importId: "new", automatic: true }, f.dependencies);
  assert.equal(f.state.products[0].sourcePrice, 900);
  assert.equal(f.state.products[0].price, 1000);
  const lower = fixture();
  lower.state.imports[0].priceMode = "SOURCE_ONLY";
  lower.state.rows[0].parsedData.sourcePrice = 500;
  await applyPriceImport({ importId: "new" }, lower.dependencies);
  assert.equal(lower.state.products[0].sourcePrice, 700);
});

test("changed names, duplicate identities and weak recognition never apply prices automatically", () => {
  const input = {
    row: row(),
    products: [product()],
    sourceDate: newDate,
    baselineDate: oldDate,
    priceMode: "PRICE_AS_IS",
  };
  assert.equal(decidePriceRow(input).kind, "INCREASE");
  assert.equal(
    decidePriceRow({ ...input, row: { ...input.row, confidence: 40 } }).kind,
    "REVIEW",
  );
  assert.equal(decidePriceRow({ ...input, duplicateSku: true }).kind, "REVIEW");
  assert.equal(
    decidePriceRow({
      ...input,
      products: [product(), { ...product(), id: "duplicate" }],
    }).kind,
    "REVIEW",
  );
  assert.equal(
    decidePriceRow({
      ...input,
      row: {
        ...input.row,
        parsedData: { ...parsed(), normalizedName: "Другой товар" },
      },
    }).kind,
    "REVIEW",
  );
  assert.equal(
    decidePriceRow({ ...input, sourceDate: oldDate }).kind,
    "REVIEW",
  );
});

test("price, audit and row marker roll back together if the application record fails", async () => {
  const f = fixture();
  f.flags.failRow = true;
  await applyPriceImport({ importId: "new", automatic: true }, f.dependencies);
  assert.equal(f.state.products[0].price, 1000);
  assert.equal(f.state.rows[0].appliedAt, null);
  assert.equal(f.state.histories.length, 0);
});

test("price dates reject nonexistent calendar days and follow Kazakhstan's business day", () => {
  assert.equal(sourceDay("2026-02-31"), null);
  assert.equal(sourceDay("19.10.2026"), null);
  assert.equal(
    priceToday(new Date("2026-10-18T20:30:00Z")).toISOString(),
    "2026-10-19T00:00:00.000Z",
  );
  assert.equal(
    dateBlock(sourceDay("2026-10-19"), null, new Date("2026-10-18T20:30:00Z")),
    null,
  );
});

test("large automatic imports resume from row markers without repeating completed prices", async () => {
  const f = fixture();
  f.state.products = Array.from({ length: 105 }, (_, index) => ({
    ...product(),
    id: `p${index}`,
    supplierSku: `SKU${index}`,
  }));
  f.state.rows = f.state.products.map((p, index) => ({
    ...row(p.supplierSku!, 1200, `row${index}`),
    productId: p.id,
  }));
  f.state.previousRows = f.state.products.map((p, index) => ({
    ...row(p.supplierSku!, 1000, `old${index}`),
    productId: p.id,
    importId: "old",
    appliedAt: oldDate,
  }));
  const first = await applyPriceImport(
    { importId: "new", automatic: true },
    f.dependencies,
  );
  assert.equal(first.import?.reconciliation.automaticApplied, 100);
  assert.equal(first.import?.reconciliation.automaticPending, 5);
  assert.equal(first.import?.status, "REVIEW");
  const second = await applyPriceImport(
    { importId: "new", automatic: true },
    f.dependencies,
  );
  assert.equal(second.import?.reconciliation.automaticApplied, 105);
  assert.equal(second.import?.status, "APPLIED");
  assert.equal(f.state.histories.length, 105);
  await applyPriceImport({ importId: "new", automatic: true }, f.dependencies);
  assert.equal(f.state.histories.length, 105);
});

test("a changed document date cannot be applied from a stale request", async () => {
  const f = fixture();
  f.flags.beforeTransaction = () => {
    f.state.imports[0].sourceDate = new Date("2020-03-01");
  };
  await applyPriceImport({ importId: "new", automatic: true }, f.dependencies);
  assert.equal(f.state.products[0].price, 1000);
  assert.equal(f.state.rows[0].appliedAt, null);
});

test("automatic price updates do not assign a new image from the price list", async () => {
  const f = fixture();
  f.state.products[0].variants = [
    { id: "v", sku: "SKU1", label: "50 мл", price: 1000, stock: 7 },
  ];
  Object.assign(f.state.rows[0].parsedData, {
    priceImageUrl: "https://brand.example/new-photo.jpg",
  });
  await applyPriceImport({ importId: "new", automatic: true }, f.dependencies);
  assert.equal(f.state.products[0].variants[0].price, 1200);
  assert.equal(f.state.products[0].variants[0].image, undefined);
  assert.equal(f.state.products[0].image, "/own-photo.jpg");
});
