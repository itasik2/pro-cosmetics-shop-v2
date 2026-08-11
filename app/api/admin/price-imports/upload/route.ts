export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import {
  ImportRowAction,
  PriceImportStatus,
  type Prisma,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import {
  normalizeParserMode,
  parsePriceListPdf,
} from "@/lib/price-import/parsePriceList";
import {
  calculateSalePrice,
  normalizeMarkupPercent,
  normalizePriceMode,
  normalizeRoundingStep,
} from "@/lib/price-import/pricing";
import {
  autoVariantGroupKeys,
  existingProductGroupKey,
  normalizeStoredVariants,
  parsedProductGroupKey,
} from "@/lib/price-import/productVariants";
import { slugify } from "@/lib/slug";

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

function cleanText(value: FormDataEntryValue | null, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function normalizeLookup(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
}

function productKey(brand: string, sku: string) {
  return `${normalizeLookup(brand)}::${sku.toUpperCase()}`;
}

function normalizeSiteUrl(value: string) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("supplier_site_url_invalid");
  }
  url.hash = "";
  return url.toString();
}

function isPdf(file: File, bytes: Uint8Array) {
  const extensionIsPdf = file.name.toLowerCase().endsWith(".pdf");
  const mimeIsPdf = file.type === "application/pdf" || file.type === "";
  const signature = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  return extensionIsPdf && mimeIsPdf && signature === "%PDF-";
}

async function ensureSupplier(input: {
  name: string;
  siteUrl: string | null;
}) {
  const slug = slugify(input.name);
  if (!slug) throw new Error("supplier_slug_empty");

  const existing = await prisma.supplier.findFirst({
    where: {
      OR: [
        { slug },
        { name: { equals: input.name, mode: "insensitive" } },
      ],
    },
  });

  if (existing) {
    return prisma.supplier.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        siteUrl: input.siteUrl || existing.siteUrl,
        isActive: true,
      },
    });
  }

  return prisma.supplier.create({
    data: {
      name: input.name,
      slug,
      siteUrl: input.siteUrl,
      isActive: true,
    },
  });
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let importId: string | null = null;

  try {
    const form = await req.formData();
    const file = form.get("file");
    const supplierName = cleanText(form.get("supplierName"), 160);
    const supplierSiteUrl = normalizeSiteUrl(
      cleanText(form.get("supplierSiteUrl"), 2_000),
    );
    const defaultBrand = cleanText(form.get("defaultBrand"), 160);
    const parserMode = normalizeParserMode(form.get("parserMode"));

    if (!supplierName) {
      return NextResponse.json({ error: "supplier_name_required" }, { status: 400 });
    }
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
    const supplier = await ensureSupplier({
      name: supplierName,
      siteUrl: supplierSiteUrl,
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

    if (duplicate && duplicate.status !== PriceImportStatus.FAILED) {
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

    if (duplicate?.status === PriceImportStatus.FAILED) {
      await prisma.priceImport.delete({ where: { id: duplicate.id } });
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

    const parsed = await parsePriceListPdf({
      bytes,
      fileName: file.name,
      parserMode,
      defaultBrand,
    });

    const variantGroupKeys = autoVariantGroupKeys(parsed.rows);
    const existingProducts = await prisma.product.findMany({
      where: {
        supplierId: supplier.id,
        enrichmentStatus: { not: "MERGED" },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        supplierSku: true,
        name: true,
        price: true,
        category: true,
        productLineCode: true,
        productLineName: true,
        volumeValue: true,
        volumeUnit: true,
        variants: true,
        isPublished: true,
        image: true,
        brand: { select: { name: true } },
      },
    });

    const existingByBrandSku = new Map<string, (typeof existingProducts)[number]>();
    const existingByGroup = new Map<string, Array<(typeof existingProducts)[number]>>();

    for (const product of existingProducts) {
      const brandName = product.brand?.name;
      if (!brandName) continue;

      if (product.supplierSku) {
        existingByBrandSku.set(productKey(brandName, product.supplierSku), product);
      }
      for (const variant of normalizeStoredVariants(product.variants)) {
        if (variant.sku) {
          existingByBrandSku.set(productKey(brandName, variant.sku), product);
        }
      }

      const groupKey = existingProductGroupKey({
        brandName,
        name: product.name,
        category: product.category,
        productLineCode: product.productLineCode,
        productLineName: product.productLineName,
        volumeValue: product.volumeValue,
        volumeUnit: product.volumeUnit,
      });
      if (groupKey) {
        const list = existingByGroup.get(groupKey) ?? [];
        list.push(product);
        existingByGroup.set(groupKey, list);
      }
    }

    const groupedRows = new Map<string, typeof parsed.rows>();
    for (const row of parsed.rows) {
      const key = parsedProductGroupKey(row);
      if (!key || !variantGroupKeys.has(key)) continue;
      const list = groupedRows.get(key) ?? [];
      list.push(row);
      groupedRows.set(key, list);
    }

    const groupCanonical = new Map<string, (typeof existingProducts)[number]>();
    for (const [key, rows] of groupedRows) {
      const skuMatches = rows
        .map((row) =>
          row.supplierSku
            ? existingByBrandSku.get(productKey(row.brand, row.supplierSku))
            : undefined,
        )
        .filter((row): row is (typeof existingProducts)[number] => Boolean(row));
      const candidates = skuMatches.length ? skuMatches : existingByGroup.get(key) ?? [];
      const unique = [...new Map(candidates.map((product) => [product.id, product])).values()];
      const canonical = [...unique].sort((a, b) => {
        const aScore = normalizeStoredVariants(a.variants).length * 100 + (a.isPublished ? 20 : 0) + (!a.image.startsWith("/seed/") ? 10 : 0);
        const bScore = normalizeStoredVariants(b.variants).length * 100 + (b.isPublished ? 20 : 0) + (!b.image.startsWith("/seed/") ? 10 : 0);
        return bScore - aScore;
      })[0];
      if (canonical) groupCanonical.set(key, canonical);
    }

    const rowData: Prisma.PriceImportRowCreateManyInput[] = parsed.rows.map((row) => {
      const groupKey = parsedProductGroupKey(row);
      const autoVariant = Boolean(groupKey && variantGroupKeys.has(groupKey));
      const skuExisting = row.supplierSku
        ? existingByBrandSku.get(productKey(row.brand, row.supplierSku))
        : undefined;
      const existing = autoVariant && groupKey
        ? groupCanonical.get(groupKey) ?? skuExisting
        : skuExisting;
      const retailRestricted =
        priceMode === "PRICE_AS_IS" &&
        row.warnings.includes("retail_sale_restricted");
      const requiresManualReview =
        !row.brand ||
        !row.supplierSku ||
        retailRestricted ||
        row.warnings.includes("brand_not_found") ||
        row.warnings.includes("duplicate_sku_in_file");
      const action = requiresManualReview
        ? ImportRowAction.MANUAL_REVIEW
        : existing
          ? ImportRowAction.UPDATE
          : ImportRowAction.CREATE;
      const salePrice = calculateSalePrice({
        sourcePrice: row.sourcePrice,
        recommendedPrice: row.recommendedPrice,
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
          parserId: parsed.parserId,
          brand: row.brand,
          originalName: row.originalName,
          description: row.description,
          volumeLabel: row.volumeLabel,
          sourcePrice: row.sourcePrice,
          recommendedPrice: row.recommendedPrice,
          warnings: row.warnings,
          autoVariant,
          variantGroupKey: autoVariant ? groupKey : null,
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
    });

    if (rowData.length) {
      await prisma.priceImportRow.createMany({ data: rowData });
    }

    const sourceDate = parsed.sourceDate
      ? new Date(`${parsed.sourceDate}T00:00:00.000Z`)
      : null;
    const validRows = rowData.filter(
      (row) =>
        (row.confidence ?? 0) >= 75 &&
        row.action !== ImportRowAction.MANUAL_REVIEW,
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
          id: parsed.parserId,
          pageCount: parsed.pageCount,
          warnings: parsed.warnings,
          manualReviewRows: manualRows,
          autoVariantGroups: variantGroupKeys.size,
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
      { error: "price_import_failed", message, retryable: true },
      { status: 422 },
    );
  }
}
