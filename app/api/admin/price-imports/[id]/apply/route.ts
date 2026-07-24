export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import {
  ImportRowAction,
  PriceImportStatus,
  type Prisma,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { ParsedImportRowSchema, type ParsedImportRow } from "@/lib/price-import/parsedRow";
import { normalizePriceMode } from "@/lib/price-import/pricing";
import { slugify } from "@/lib/slug";
import { uniqueSlug } from "@/lib/uniqueSlug";

type Params = { params: { id: string } };

function parseSourceDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function normalizeBrandName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function importedDescription(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function descriptionIsPlaceholder(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");
  return !normalized || normalized === "описание готовится";
}

async function ensureBrand(name: string) {
  const normalizedName = normalizeBrandName(name);
  if (!normalizedName) throw new Error("brand_required");

  const baseSlug = slugify(normalizedName);
  if (!baseSlug) throw new Error("brand_slug_empty");

  const existing = await prisma.brand.findFirst({
    where: {
      OR: [
        { slug: baseSlug },
        { name: { equals: normalizedName, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
  });

  if (existing) {
    await prisma.brand.update({
      where: { id: existing.id },
      data: { isActive: true },
    });
    return existing;
  }

  const slug = await uniqueSlug({ model: "brand", value: baseSlug });
  return prisma.brand.create({
    data: {
      name: normalizedName,
      slug,
      isActive: true,
      sortOrder: 0,
    },
    select: { id: true, name: true },
  });
}

async function updateExistingProduct(input: {
  tx: Prisma.TransactionClient;
  productId: string;
  parsed: ParsedImportRow;
  importId: string;
  supplierId: string;
  brandId: string;
  sourceOnly: boolean;
}) {
  const product = await input.tx.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      price: true,
      description: true,
      volumeValue: true,
      volumeUnit: true,
      productLineCode: true,
      productLineName: true,
    },
  });

  if (!product) throw new Error("product_not_found");

  const nextPrice = input.sourceOnly ? product.price : input.parsed.salePrice;
  const nextDescription = importedDescription(input.parsed.description);
  await input.tx.product.update({
    where: { id: product.id },
    data: {
      brandId: input.brandId,
      supplierId: input.supplierId,
      supplierSku: input.parsed.supplierSku,
      sourcePrice: input.parsed.sourcePrice,
      price: nextPrice,
      priceListDate: parseSourceDate(input.parsed.sourceDate),
      lastImportedAt: new Date(),
      volumeValue: product.volumeValue ?? input.parsed.volumeValue,
      volumeUnit: product.volumeUnit ?? input.parsed.volumeUnit,
      productLineCode: product.productLineCode ?? input.parsed.productLineCode,
      productLineName: product.productLineName ?? input.parsed.productLineName,
      ...(nextDescription && descriptionIsPlaceholder(product.description)
        ? { description: nextDescription }
        : {}),
    },
  });

  if (product.price !== nextPrice) {
    await input.tx.productPriceHistory.create({
      data: {
        productId: product.id,
        importId: input.importId,
        oldPrice: product.price,
        newPrice: nextPrice,
        sourcePrice: input.parsed.sourcePrice,
      },
    });
  }

  return product.id;
}

export async function POST(_req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const priceImport = await prisma.priceImport.findUnique({
    where: { id: params.id },
    include: {
      supplier: true,
      rows: {
        where: { selected: true },
        orderBy: [{ pageNumber: "asc" }, { rowNumber: "asc" }],
      },
    },
  });

  if (!priceImport) {
    return NextResponse.json({ error: "import_not_found" }, { status: 404 });
  }
  if (priceImport.status !== PriceImportStatus.REVIEW) {
    return NextResponse.json(
      { error: "import_not_ready", status: priceImport.status },
      { status: 409 },
    );
  }

  const sourceOnly = normalizePriceMode(priceImport.priceMode) === "SOURCE_ONLY";
  const brandCache = new Map<string, { id: string; name: string }>();

  let createdRows = 0;
  let updatedRows = 0;
  let skippedRows = 0;
  let errorRows = 0;

  for (const row of priceImport.rows) {
    if (
      row.action === ImportRowAction.SKIP ||
      row.action === ImportRowAction.ERROR ||
      row.action === ImportRowAction.MANUAL_REVIEW
    ) {
      skippedRows += 1;
      continue;
    }

    try {
      const parsed = ParsedImportRowSchema.parse(row.parsedData);

      if (!parsed.supplierSku) {
        throw new Error("sku_required_for_apply");
      }

      const brandKey = normalizeBrandName(parsed.brand).toLocaleLowerCase("ru-RU");
      let brand = brandCache.get(brandKey);
      if (!brand) {
        brand = await ensureBrand(parsed.brand);
        brandCache.set(brandKey, brand);
      }

      const skuOwner = await prisma.product.findFirst({
        where: {
          supplierId: priceImport.supplierId,
          supplierSku: parsed.supplierSku,
        },
        select: { id: true, brandId: true },
      });

      if (skuOwner && skuOwner.brandId && skuOwner.brandId !== brand.id) {
        throw new Error("supplier_sku_used_by_another_brand");
      }

      const matchedProduct = row.productId
        ? await prisma.product.findFirst({
            where: { id: row.productId, brandId: brand.id },
            select: { id: true },
          })
        : skuOwner;

      if (matchedProduct) {
        const productId = await prisma.$transaction((tx) =>
          updateExistingProduct({
            tx,
            productId: matchedProduct.id,
            parsed,
            importId: priceImport.id,
            supplierId: priceImport.supplierId,
            brandId: brand.id,
            sourceOnly,
          }),
        );

        await prisma.priceImportRow.update({
          where: { id: row.id },
          data: {
            productId,
            action: ImportRowAction.UPDATE,
            error: null,
          },
        });
        updatedRows += 1;
        continue;
      }

      if (row.action !== ImportRowAction.CREATE) {
        throw new Error("product_match_required");
      }

      const baseSlug = slugify(
        `${brand.name}-${parsed.normalizedName}-${parsed.volumeLabel || parsed.supplierSku}`,
      );
      const slug = await uniqueSlug({ model: "product", value: baseSlug });
      const initialPrice = sourceOnly ? parsed.sourcePrice : parsed.salePrice;
      const description = importedDescription(parsed.description) || "Описание готовится";

      const productId = await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name: parsed.normalizedName,
            slug,
            brandId: brand.id,
            supplierId: priceImport.supplierId,
            supplierSku: parsed.supplierSku,
            description,
            price: initialPrice,
            sourcePrice: parsed.sourcePrice,
            image: "/seed/cleanser.jpg",
            category: parsed.category,
            stock: 0,
            volumeValue: parsed.volumeValue,
            volumeUnit: parsed.volumeUnit,
            productLineCode: parsed.productLineCode,
            productLineName: parsed.productLineName,
            priceListDate: parseSourceDate(parsed.sourceDate),
            lastImportedAt: new Date(),
            isPublished: false,
            enrichmentStatus: "PENDING",
            isPopular: false,
            isNew: true,
          },
          select: { id: true },
        });

        await tx.productPriceHistory.create({
          data: {
            productId: product.id,
            importId: priceImport.id,
            oldPrice: null,
            newPrice: initialPrice,
            sourcePrice: parsed.sourcePrice,
          },
        });

        return product.id;
      });

      await prisma.priceImportRow.update({
        where: { id: row.id },
        data: {
          productId,
          action: ImportRowAction.CREATE,
          error: null,
        },
      });
      createdRows += 1;
    } catch (error: any) {
      errorRows += 1;
      await prisma.priceImportRow.update({
        where: { id: row.id },
        data: {
          action: ImportRowAction.ERROR,
          selected: false,
          error: String(error?.message || "row_apply_failed").slice(0, 500),
        },
      });
    }
  }

  const updatedImport = await prisma.priceImport.update({
    where: { id: priceImport.id },
    data: {
      status: PriceImportStatus.APPLIED,
      appliedAt: new Date(),
      createdRows,
      updatedRows,
      skippedRows,
      errorRows,
    },
    include: {
      supplier: true,
      rows: {
        orderBy: [{ pageNumber: "asc" }, { rowNumber: "asc" }],
      },
    },
  });

  return NextResponse.json({ import: updatedImport });
}
