import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { productPriceSources } from "../lib/productPriceSources";
import {
  applyProductActions,
  productActionSchema,
} from "../lib/adminProductActions";
import {
  emptyProductFilters,
  productMatchesFilters,
  selectedVisibleProducts,
} from "../lib/adminProductFilters";
import { requestProductActions } from "../app/admin/(private)/products/productActions";
import ProductPriceSources from "../app/admin/(private)/products/ProductPriceSources";
import ProductSelectionBar from "../app/admin/(private)/products/ProductSelectionBar";
import {
  recoverStaleEnrichmentJobs,
  STALE_ENRICHMENT_MS,
} from "../lib/enrichment/recoverStaleJobs";

const appliedRow = (
  sku: string,
  file: string,
  day: number,
  overrides = {},
) => ({
  supplierSku: sku,
  rowNumber: 12,
  pageNumber: 2,
  appliedAt: new Date(`2026-10-${day}T08:00:00Z`),
  import: {
    id: file,
    fileName: `${file}.xlsx`,
    sourceDate: new Date(`2026-10-${day}T00:00:00Z`),
  },
  ...overrides,
});

test("provenance uses applied rows, current SKU and document date rather than upload order", () => {
  const sources = productPriceSources({ supplierSku: " a-01 " }, [
    appliedRow("A-01", "fresh", 19),
    appliedRow("a-01", "old", 18, {
      appliedAt: new Date("2026-10-20T08:00:00Z"),
    }),
    appliedRow("A-01", "not-applied", 20, { appliedAt: null }),
    appliedRow("A-02", "wrong-sku", 20),
  ]);
  assert.deepEqual(
    sources.map((source) => source.importId),
    ["fresh"],
  );
  assert.deepEqual(sources[0].skus, ["A-01"]);
  assert.deepEqual(sources[0].rowNumbers, [12]);
  assert.equal(sources[0].sourceDate, "2026-10-19T00:00:00.000Z");
});

test("variants retain their own price-list source and removed variants do not appear", () => {
  const sources = productPriceSources(
    { supplierSku: "REMOVED", variants: [{ sku: "S" }, { sku: "L" }] },
    [
      appliedRow("S", "small-price", 18),
      appliedRow("L", "large-price", 19),
      appliedRow("REMOVED", "removed-price", 20),
    ],
  );
  assert.deepEqual(
    sources.map((source) => source.importId),
    ["large-price", "small-price"],
  );
  assert.deepEqual(sources[0].skus, ["L"]);
  const grouped = productPriceSources(
    { variants: [{ sku: "S" }, { sku: "L" }] },
    [
      appliedRow("S", "same-price", 18),
      appliedRow("L", "same-price", 18, { rowNumber: 13, pageNumber: 3 }),
    ],
  );
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].skus, ["S", "L"]);
  assert.deepEqual(grouped[0].rowNumbers, [12, 13]);
  assert.deepEqual(grouped[0].pageNumbers, [2, 3]);
});

test("price provenance renders file, dates, SKU and a read-only review link", () => {
  const sources = productPriceSources({ supplierSku: "SKU" }, [
    appliedRow("SKU", "Поставщик октябрь", 19),
  ]);
  const html = renderToStaticMarkup(<ProductPriceSources sources={sources} />);
  for (const text of [
    "Поставщик октябрь.xlsx",
    "19.10.2026",
    "SKU",
    "Строки: 12",
    "страницы: 2",
    "importId=",
  ])
    assert.ok(html.includes(text), text);
  assert.match(
    renderToStaticMarkup(<ProductPriceSources />),
    /Источник прайса не определён/,
  );
});

test("bulk selection only includes products matching all current filters and selected IDs", () => {
  const product = {
    id: "wanted",
    name: "Крем",
    category: "лицо",
    brandId: "brand",
    supplier: { id: "supplier" },
    isPublished: true,
    stock: 5,
    image: "/seed/cream.jpg",
    isNew: false,
    isPopular: false,
    priceSources: [{ importId: "price" }],
  };
  const products = [
    product,
    { ...product, id: "other-brand", brandId: "other" },
    { ...product, id: "other-supplier", supplier: { id: "other" } },
    { ...product, id: "other-price", priceSources: [{ importId: "old" }] },
    { ...product, id: "with-photo", image: "/media/cream.jpg" },
  ];
  const filters = {
    ...emptyProductFilters,
    brand: "brand",
    supplier: "supplier",
    priceImport: "price",
    content: "no-photo" as const,
  };
  const visible = products.filter((item) =>
    productMatchesFilters(item, filters),
  );
  assert.deepEqual(
    selectedVisibleProducts(
      visible,
      new Set(products.map((item) => item.id)),
    ).map((item) => item.id),
    ["wanted"],
  );
  assert.deepEqual(selectedVisibleProducts(visible, new Set(["hidden"])), []);
});

test("bulk controls name the filtered count and both supported actions", () => {
  const html = renderToStaticMarkup(
    <ProductSelectionBar
      total={7}
      selected={3}
      busy={false}
      progress=""
      onSelectAll={() => {}}
      onClear={() => {}}
      onAction={() => {}}
    />,
  );
  for (const text of [
    "Выбрать все найденные (7)",
    "Выбрано: 3 из 7",
    "Снять с публикации (3)",
    "Удалить выбранные (3)",
    "текущим фильтрам и поиску",
  ])
    assert.ok(html.includes(text), text);
});

test("bulk requests reject unsafe or oversized input and deduplicate IDs", () => {
  for (const input of [
    { action: "publish", ids: ["a"] },
    { action: "delete", ids: [] },
    { action: "delete", ids: [""] },
    { action: "delete", ids: Array(101).fill("a") },
    { action: "delete", ids: ["a"], all: true },
  ])
    assert.equal(productActionSchema.safeParse(input).success, false);
  assert.deepEqual(
    productActionSchema.parse({ action: "delete", ids: ["a", "a", "b"] }).ids,
    ["a", "b"],
  );
});

function actionFixture() {
  let state = ["a", "b", "merged", "running", "race"].map((id) => ({
    id,
    name: `Товар ${id}`,
    updatedAt: new Date(1000),
    enrichmentStatus: id === "merged" ? "MERGED" : "READY",
    isPublished: true,
    stock: 8,
    price: 5000,
    image: "/media/photo.jpg",
    variants: [{ sku: id, stock: 8 }],
  }));
  let jobs = [
    {
      id: "job",
      productId: "running",
      status: "RUNNING",
      updatedAt: new Date(),
      scheduledAt: new Date(),
      finishedAt: null,
      error: null,
    },
  ];
  const writes: string[] = [];
  const database = {
    $transaction: async (
      callback: (tx: any) => Promise<unknown>,
      options: any,
    ) => {
      assert.equal(options.isolationLevel, "Serializable");
      const draft = structuredClone(state);
      let draftJobs = structuredClone(jobs);
      const result = await callback({
        product: {
          findUnique: async ({ where }: any) =>
            draft.find((row) => row.id === where.id) ?? null,
          updateMany: async ({ where, data }: any) => {
            if (where.enrichmentStatus === "RUNNING") {
              const matches = draft.filter(
                (row) =>
                  (!where.id || where.id.in.includes(row.id)) &&
                  row.enrichmentStatus === where.enrichmentStatus &&
                  +row.updatedAt < +where.updatedAt.lt &&
                  !draftJobs.some(
                    (job) =>
                      job.productId === row.id &&
                      where.enrichmentJobs.none.status.in.includes(job.status),
                  ),
              );
              matches.forEach((row) =>
                Object.assign(row, data, { updatedAt: new Date() }),
              );
              return { count: matches.length };
            }
            assert.deepEqual(data, { isPublished: false });
            const row = draft.find(
              (row) =>
                row.id === where.id && +row.updatedAt === +where.updatedAt,
            );
            if (!row || row.id === "race") return { count: 0 };
            Object.assign(row, data);
            writes.push(row.id);
            return { count: 1 };
          },
          deleteMany: async ({ where }: any) => {
            const index = draft.findIndex(
              (row) =>
                row.id === where.id && +row.updatedAt === +where.updatedAt,
            );
            if (index < 0 || where.id === "race") return { count: 0 };
            draft.splice(index, 1);
            draftJobs = draftJobs.filter((job) => job.productId !== where.id);
            writes.push(where.id);
            return { count: 1 };
          },
        },
        enrichmentJob: {
          findFirst: async ({ where }: any) =>
            draftJobs.find(
              (job) =>
                job.productId === where.productId &&
                where.status.in.includes(job.status),
            ) || null,
          updateMany: async ({ where, data }: any) => {
            const matches = draftJobs.filter(
              (job) =>
                (!where.productId ||
                  where.productId.in.includes(job.productId)) &&
                +job.updatedAt < +where.updatedAt.lt &&
                where.OR.some(
                  (part: any) =>
                    job.status === part.status &&
                    (!part.scheduledAt ||
                      +job.scheduledAt < +part.scheduledAt.lt),
                ),
            );
            matches.forEach((job) => Object.assign(job, data));
            return { count: matches.length };
          },
        },
      });
      state = draft;
      jobs = draftJobs;
      return result;
    },
  } as unknown as NonNullable<Parameters<typeof applyProductActions>[1]>;
  return {
    database,
    writes,
    recover: (ids?: string[], now = new Date()) =>
      database.$transaction((tx) => recoverStaleEnrichmentJobs(tx, ids, now), {
        isolationLevel: "Serializable",
      }),
    get jobs() {
      return jobs;
    },
    get state() {
      return state;
    },
  };
}

test("bulk unpublish preserves stock, price, images, variants and unrelated products", async () => {
  const fixture = actionFixture();
  const before = structuredClone(fixture.state);
  const result = await applyProductActions(
    { action: "unpublish", ids: ["a"] },
    fixture.database,
  );
  assert.deepEqual(result, { processedIds: ["a"], failures: [] });
  assert.deepEqual(
    fixture.state,
    before.map((row) =>
      row.id === "a" ? { ...row, isPublished: false } : row,
    ),
  );
});

test("bulk delete reports each failure, blocks active AI/merged cards and detects stale writes", async () => {
  const fixture = actionFixture();
  const result = await applyProductActions(
    { action: "delete", ids: ["a", "missing", "merged", "running", "race"] },
    fixture.database,
  );
  assert.deepEqual(result.processedIds, ["a"]);
  assert.deepEqual(
    result.failures.map((row) => row.id),
    ["missing", "merged", "running", "race"],
  );
  assert.match(
    result.failures.find((row) => row.id === "running")!.message,
    /поиск ИИ/,
  );
  assert.match(
    result.failures.find((row) => row.id === "race")!.message,
    /изменился/,
  );
  assert.deepEqual(fixture.writes, ["a"]);
  assert.deepEqual(
    fixture.state.map((row) => row.id),
    ["b", "merged", "running", "race"],
  );
});

test("a month-old WH03 search expires and unpublish preserves product content and inventory", async () => {
  const fixture = actionFixture();
  const row = fixture.state.find((row) => row.id === "running")!;
  row.enrichmentStatus = "RUNNING";
  fixture.jobs[0].updatedAt = new Date(Date.now() - 38 * 24 * 60 * 60 * 1000);
  const before = structuredClone(row);
  const result = await applyProductActions(
    { action: "unpublish", ids: [row.id] },
    fixture.database,
  );
  assert.deepEqual(result, { processedIds: [row.id], failures: [] });
  const after = fixture.state.find((product) => product.id === row.id)!;
  assert.deepEqual(
    { ...after, updatedAt: before.updatedAt },
    { ...before, isPublished: false, enrichmentStatus: "FAILED" },
  );
  assert.equal(fixture.jobs[0].status, "FAILED");
  assert.equal(fixture.jobs[0].error, "stale_enrichment_job_recovered");
  assert.ok(fixture.jobs[0].finishedAt);
});

test("an expired search cannot permanently prevent deleting the selected product", async () => {
  const fixture = actionFixture();
  fixture.state.find((row) => row.id === "running")!.enrichmentStatus =
    "RUNNING";
  fixture.jobs[0].updatedAt = new Date(
    Date.now() - STALE_ENRICHMENT_MS - 60_000,
  );
  assert.deepEqual(
    await applyProductActions(
      { action: "delete", ids: ["running"] },
      fixture.database,
    ),
    { processedIds: ["running"], failures: [] },
  );
  assert.ok(!fixture.state.some((row) => row.id === "running"));
  assert.ok(!fixture.jobs.length);
  assert.deepEqual(fixture.writes, ["running"]);
});

test("recovery releases only old orphan claims and keeps fresh claims and newer jobs locked", async () => {
  const fixture = actionFixture();
  const old = fixture.state.find((row) => row.id === "a")!;
  const fresh = fixture.state.find((row) => row.id === "b")!;
  old.enrichmentStatus = fresh.enrichmentStatus = "RUNNING";
  fresh.updatedAt = new Date();
  fixture.state.find((row) => row.id === "running")!.enrichmentStatus =
    "RUNNING";
  const result = await applyProductActions(
    { action: "unpublish", ids: ["a", "b", "running"] },
    fixture.database,
  );
  assert.deepEqual(result.processedIds, ["a"]);
  assert.deepEqual(
    result.failures.map((row) => row.id),
    ["b", "running"],
  );
  assert.equal(fixture.jobs[0].status, "RUNNING");
  assert.equal(
    fixture.state.find((row) => row.id === "running")!.enrichmentStatus,
    "RUNNING",
  );
});

test("an intentionally scheduled pending job is protected while an overdue abandoned job expires", async () => {
  for (const future of [true, false]) {
    const fixture = actionFixture();
    fixture.state.find((row) => row.id === "running")!.enrichmentStatus =
      "RUNNING";
    const old = new Date(Date.now() - STALE_ENRICHMENT_MS - 60_000);
    Object.assign(fixture.jobs[0], {
      status: "PENDING",
      updatedAt: old,
      scheduledAt: future ? new Date(Date.now() + 60_000) : old,
    });
    const result = await applyProductActions(
      { action: "unpublish", ids: ["running"] },
      fixture.database,
    );
    assert.equal(result.processedIds.length, future ? 0 : 1);
    assert.equal(fixture.jobs[0].status, future ? "PENDING" : "FAILED");
  }
});

test("recovery is scoped and idempotent; an empty explicit scope never becomes all products", async () => {
  const fixture = actionFixture();
  fixture.state.find((row) => row.id === "running")!.enrichmentStatus =
    "RUNNING";
  fixture.jobs[0].updatedAt = new Date(
    Date.now() - STALE_ENRICHMENT_MS - 60_000,
  );
  assert.deepEqual(await fixture.recover([]), {
    expiredJobs: 0,
    unlockedProducts: 0,
  });
  assert.deepEqual(await fixture.recover(["a"]), {
    expiredJobs: 0,
    unlockedProducts: 0,
  });
  assert.equal(fixture.jobs[0].status, "RUNNING");
  assert.deepEqual(await fixture.recover(["running"]), {
    expiredJobs: 1,
    unlockedProducts: 1,
  });
  assert.deepEqual(await fixture.recover(["running"]), {
    expiredJobs: 0,
    unlockedProducts: 0,
  });
});

test("failed conditional writes roll back recovery with the product action", async () => {
  const fixture = actionFixture();
  fixture.state.find((row) => row.id === "race")!.enrichmentStatus = "RUNNING";
  const before = structuredClone(fixture.state);
  const result = await applyProductActions(
    { action: "unpublish", ids: ["race"] },
    fixture.database,
  );
  assert.deepEqual(result.processedIds, []);
  assert.match(result.failures[0].message, /изменился/);
  assert.deepEqual(fixture.state, before);
});

test("a new running job retains its claim when an older job for the same product expires", async () => {
  const fixture = actionFixture();
  fixture.state.find((row) => row.id === "running")!.enrichmentStatus =
    "RUNNING";
  fixture.jobs[0].updatedAt = new Date(
    Date.now() - STALE_ENRICHMENT_MS - 60_000,
  );
  fixture.jobs.push({
    ...fixture.jobs[0],
    id: "new-job",
    updatedAt: new Date(),
  });
  assert.deepEqual(await fixture.recover(["running"]), {
    expiredJobs: 1,
    unlockedProducts: 0,
  });
  assert.equal(fixture.jobs[0].status, "FAILED");
  assert.equal(fixture.jobs[1].status, "RUNNING");
  assert.equal(
    fixture.state.find((row) => row.id === "running")!.enrichmentStatus,
    "RUNNING",
  );
});

test("client batches explicit selected IDs and keeps per-product failures", async (t) => {
  const requests: string[][] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      const input = JSON.parse(String(options.body));
      assert.equal(input.action, "delete");
      requests.push(input.ids);
      return Response.json({
        processedIds: input.ids.filter((id: string) => id !== "2"),
        failures: input.ids.includes("2")
          ? [{ id: "2", name: "Товар 2", message: "Ошибка" }]
          : [],
      });
    },
  );
  const products = Array.from({ length: 51 }, (_, i) => ({
    id: String(i),
    name: `Товар ${i}`,
  }));
  const progress: number[] = [];
  const result = await requestProductActions("delete", products, (done) =>
    progress.push(done),
  );
  assert.deepEqual(
    requests.map((batch) => batch.length),
    [50, 1],
  );
  assert.deepEqual(
    requests.flat(),
    products.map((product) => product.id),
  );
  assert.deepEqual(progress, [50, 51]);
  assert.equal(result.processedIds.length, 50);
  assert.deepEqual(
    result.failures.map((row) => row.id),
    ["2"],
  );
});

test("failed batch stops further writes and retains all unconfirmed products", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ message: "Нет доступа" }, { status: 403 });
  });
  const products = Array.from({ length: 101 }, (_, i) => ({
    id: String(i),
    name: `Товар ${i}`,
  }));
  const result = await requestProductActions("unpublish", products, () => {});
  assert.equal(calls, 1);
  assert.deepEqual(result.processedIds, []);
  assert.equal(result.failures.length, 101);
});
