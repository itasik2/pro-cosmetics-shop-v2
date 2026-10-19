import { Prisma, PriceImportStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { photoSku } from "../enrichment/variantImages";
import { comparePriceImportDate } from "./dateGuard";
import { ParsedImportRowSchema } from "./parsedRow";
import { normalizePriceMode } from "./pricing";
import {
  decidePriceRow,
  missingPricePositions,
  type PriceReconciliation,
} from "./reconciliationPolicy";

export const pricePolicyProductSelect = {
  id: true,
  name: true,
  supplierId: true,
  supplierSku: true,
  brandId: true,
  brand: { select: { name: true } },
  price: true,
  sourcePrice: true,
  priceListDate: true,
  stock: true,
  variants: true,
  updatedAt: true,
  volumeValue: true,
  volumeUnit: true,
  image: true,
  category: true,
} satisfies Prisma.ProductSelect;

type Database = Pick<typeof prisma, "priceImport" | "product">;
export async function priceImportContext(
  id: string,
  database: Database = prisma,
) {
  const priceImport = await database.priceImport.findUnique({
    where: { id },
    include: {
      supplier: true,
      rows: { orderBy: [{ pageNumber: "asc" }, { rowNumber: "asc" }] },
    },
  });
  if (!priceImport) return null;
  const [products, dateComparison, previous] = await Promise.all([
    database.product.findMany({
      where: {
        supplierId: priceImport.supplierId,
        enrichmentStatus: { not: "MERGED" },
      },
      select: pricePolicyProductSelect,
    }),
    comparePriceImportDate(
      {
        supplierId: priceImport.supplierId,
        sourceDate: priceImport.sourceDate,
        excludeImportId: id,
      },
      database,
    ),
    database.priceImport.findFirst({
      where: {
        supplierId: priceImport.supplierId,
        id: { not: id },
        OR: [
          { status: PriceImportStatus.APPLIED },
          { rows: { some: { appliedAt: { not: null } } } },
        ],
      },
      orderBy: [{ sourceDate: "desc" }, { appliedAt: "desc" }],
      include: { rows: true },
    }),
  ]);
  const previousBySku = new Map(
    (previous?.rows || []).flatMap((row) => {
      if (!row.appliedAt) return [];
      const parsed = ParsedImportRowSchema.safeParse(row.parsedData);
      return parsed.success && parsed.data.supplierSku
        ? [[photoSku(parsed.data.supplierSku), parsed.data] as const]
        : [];
    }),
  );
  const seen = new Set<string>(),
    duplicates = new Set<string>();
  for (const row of priceImport.rows) {
    const sku = photoSku(row.supplierSku);
    if (seen.has(sku)) duplicates.add(sku);
    if (sku) seen.add(sku);
  }
  const pricingChanged = Boolean(
    previous &&
    (normalizePriceMode(previous.priceMode) !==
      normalizePriceMode(priceImport.priceMode) ||
      previous.roundingStep !== priceImport.roundingStep ||
      (normalizePriceMode(priceImport.priceMode) === "MARKUP_PERCENT" &&
        previous.markupPercent !== priceImport.markupPercent)),
  );
  const decisions = new Map(
    priceImport.rows.map((row) => [
      row.id,
      decidePriceRow({
        row,
        products,
        sourceDate: priceImport.sourceDate,
        baselineDate: dateComparison.currentSourceDate,
        priceMode: priceImport.priceMode,
        previous: previousBySku.get(photoSku(row.supplierSku)),
        previousSourceDate: previous?.sourceDate,
        duplicateSku: duplicates.has(photoSku(row.supplierSku)),
        pricingChanged,
      }),
    ]),
  );
  return {
    priceImport,
    products,
    dateComparison,
    previousBySku,
    previousSourceDate: previous?.sourceDate,
    duplicates,
    decisions,
    pricingChanged,
  };
}

export async function readPriceImport(id: string, database: Database = prisma) {
  const context = await priceImportContext(id, database);
  if (!context) return null;
  const { priceImport, products, dateComparison, decisions } = context;
  const rows = priceImport.rows.map((row) => ({
    ...row,
    priceDecision: decisions.get(row.id)!,
  }));
  const reconciliation: PriceReconciliation = {
    missing: missingPricePositions(products, rows),
    newRows: rows.filter(
      (row) =>
        row.priceDecision.wasNew ||
        ["NEW", "NEW_VARIANT"].includes(row.priceDecision.kind) ||
        row.action === "CREATE",
    ).length,
    decreases: rows.filter((row) => row.priceDecision.kind === "DECREASE")
      .length,
    automaticApplied: rows.filter(
      (row) =>
        row.appliedAt &&
        row.priceDecision.automatic &&
        row.priceDecision.previousPrice !== row.priceDecision.nextPrice,
    ).length,
    automaticPending: rows.filter(
      (row) =>
        !row.appliedAt &&
        row.selected &&
        ["INCREASE", "UNCHANGED"].includes(row.priceDecision.kind),
    ).length,
    needsReview: rows.filter(
      (row) =>
        !row.appliedAt &&
        !["INCREASE", "UNCHANGED", "SKIP", "APPLIED"].includes(
          row.priceDecision.kind,
        ),
    ).length,
  };
  return { ...priceImport, rows, dateComparison, reconciliation };
}

export async function preparePriceImport(
  id: string,
  database: typeof prisma = prisma,
) {
  const context = await priceImportContext(id, database);
  if (!context) return;
  const decreases = [...context.decisions]
    .filter(([, decision]) => decision.kind === "DECREASE")
    .map(([id]) => id);
  if (decreases.length)
    await database.priceImportRow.updateMany({
      where: { id: { in: decreases }, importId: id, appliedAt: null },
      data: { selected: false },
    });
}
