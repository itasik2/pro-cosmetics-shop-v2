export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { createHash } from "node:crypto";
import {
  ImportRowAction,
  PriceImportStatus,
  type Prisma,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { parseAngiopharmPdf } from "@/lib/price-import/angiopharmPdf";
import {
  calculateSalePrice,
  normalizeMarkupPercent,
  normalizePriceMode,
  normalizeRoundingStep,
} from "@/lib/price-import/pricing";

const MAX_FILE_SIZE = 12 * 1024 * 1024;

async function readImport(id: string) {
  return prisma.priceImport.findUnique({
    where: { id },
    include: {
      supplier: true,
      rows: {
        orderBy: [{ pageNumber: "asc" }, { rowNumber: "asc" }],
      },
    },
  });
}

function isPdf(file: File, bytes: Uint8Array) {
  const extensionIsPdf = file.name.toLowerCase().endsWith(".pdf");
  const mimeIsPdf = file.type === "application/pdf" || file.type === "";
  const signature = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  return extensionIsPdf && mimeIsPdf && signature === "%PDF-";
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let importId: string | null = null;

  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file_required" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "empty_file" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "file_too_large", maxBytes: MAX_FILE_SIZE },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPdf(file, bytes)) {
      return NextResponse.json({ error: "pdf_required" }, { status: 400 });
    }

    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const priceMode = normalizePriceMode(form.get("priceMode"));
    const markupPercent = normalizeMarkupPercent(form.get("markupPercent"));
    const roundingStep = normalizeRoundingStep(form.get("roundingStep"));

    const supplier = await prisma.supplier.upsert({
      where: { slug: "angiopharm" },
      update: {
        name: "ANGIOPHARM",
        siteUrl: "https://angiopharm.ru",
        isActive: true,
      },
      create: {
        name: "ANGIOPHARM",
        slug: "angiopharm",
        siteUrl: "https://angiopharm.ru",
      },
    });

    const duplicate = await prisma.priceImport.findUnique({
      where: {
        supplierId_fileHash: {
          supplierId: supplier.id,
          fileHash,
        },
      },
      select: { id: true, status: true, createdAt: true },
    });

    if (duplicate) {
      return NextResponse.json(
        {
          error: "duplicate_file",
          importId: duplicate.id,
          status: duplicate.status,
          createdAt: duplicate.createdAt,
        },
        { status: 409 },
      );
    }

    const priceImport = await prisma.priceImport.create({
      data: {
        supplierId: supplier.id,
        fileName: file.name,
        fileHash,
        status: PriceImportStatus.PARSING,
        priceMode,
        markupPercent,
        roundingStep,
      },
      select: { id: true },
    });
    importId = priceImport.id;

    const parsed = await parseAngiopharmPdf(bytes);
    const skuList = Array.from(
      new Set(parsed.rows.map((row) => row.supplierSku).filter(Boolean)),
    ) as string[];

    const existingProducts = skuList.length
      ? await prisma.product.findMany({
          where: {
            supplierId: supplier.id,
            supplierSku: { in: skuList },
          },
          select: { id: true, supplierSku: true, name: true, price: true },
        })
      : [];

    const existingBySku = new Map(
      existingProducts
        .filter((product) => product.supplierSku)
        .map((product) => [product.supplierSku as string, product]),
    );

    const rowData: Prisma.PriceImportRowCreateManyInput[] = parsed.rows.map(
      (row) => {
        const existing = row.supplierSku
          ? existingBySku.get(row.supplierSku)
          : undefined;
        const requiresManualReview =
          !row.supplierSku || row.warnings.includes("duplicate_sku_in_file");
        const action = requiresManualReview
          ? ImportRowAction.MANUAL_REVIEW
          : existing
            ? ImportRowAction.UPDATE
            : ImportRowAction.CREATE;
        const salePrice = calculateSalePrice({
          sourcePrice: row.sourcePrice,
          priceMode,
          markupPercent,
          roundingStep,
        });

        return {
          importId: priceImport.id,
          rowNumber: row.rowNumber,
          pageNumber: row.pageNumber,
          supplierSku: row.supplierSku,
          productId: existing?.id ?? null,
          action,
          confidence: row.confidence,
          selected: !requiresManualReview,
          rawData: {
            originalName: row.originalName,
            volumeLabel: row.volumeLabel,
            sourcePrice: row.sourcePrice,
            warnings: row.warnings,
          },
          parsedData: {
            ...row,
            salePrice,
            existingProduct: existing
              ? {
                  id: existing.id,
                  name: existing.name,
                  price: existing.price,
                }
              : null,
          },
        };
      },
    );

    if (rowData.length) {
      await prisma.priceImportRow.createMany({ data: rowData });
    }

    const sourceDate = parsed.sourceDate
      ? new Date(`${parsed.sourceDate}T00:00:00.000Z`)
      : null;
    const validRows = rowData.filter(
      (row) =>
        row.confidence >= 80 && row.action !== ImportRowAction.MANUAL_REVIEW,
    ).length;
    const manualRows = rowData.filter(
      (row) => row.action === ImportRowAction.MANUAL_REVIEW,
    ).length;

    await prisma.priceImport.update({
      where: { id: priceImport.id },
      data: {
        sourceDate,
        status: PriceImportStatus.REVIEW,
        totalRows: rowData.length,
        validRows,
        errorRows: manualRows,
      },
    });

    const result = await readImport(priceImport.id);
    return NextResponse.json(
      {
        import: result,
        parser: {
          pageCount: parsed.pageCount,
          warnings: parsed.warnings,
          manualReviewRows: manualRows,
        },
      },
      { status: 201 },
    );
  } catch (error: any) {
    const message = String(error?.message || "price_import_failed");
    console.error("POST /api/admin/price-imports/upload", error);

    if (importId) {
      await prisma.priceImport
        .update({
          where: { id: importId },
          data: { status: PriceImportStatus.FAILED },
        })
        .catch(() => undefined);
    }

    return NextResponse.json(
      { error: "price_import_failed", message },
      { status: 422 },
    );
  }
}
