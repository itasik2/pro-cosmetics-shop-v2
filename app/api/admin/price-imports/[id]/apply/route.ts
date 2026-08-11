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
import {
  autoVariantGroupKeys,
  baseProductName,
  findVariantBySku,
  makeImportedVariant,
  mergeImportedVariant,
  normalizeStoredVariants,
  parsedProductGroupKey,
  variantLabel,
} from "@/lib/price-import/productVariants";
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
  variantMode: boolean;
}) {
  const product = await input.tx.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      name: true,
      supplierSku: true,
      price: true,
      sourcePrice: true,
      stock: true,
      image: true,
      variants: true,
      description: true,
      volumeValue: true,
      volumeUnit: true,
      productLineCode: true,
      productLineName: true,
    },
  });

  if (!product) throw new Error("product_not_found");

  const storedVariants = normalizeStoredVariants(product.variants);
  const useVariants = input.variantMode || storedVariants.length > 0;
  const nextDescription = importedDescription(input.parsed.description);

  if (useVariants) {
    const label = variantLabel(input.parsed);
    if (!label) throw new Error("variant_label_required");

    let variants = [...storedVariants];
    const existingVariant = findVariantBySku(variants, input.parsed.supplierSku);

    if (!variants.length && product.supplierSku && product.supplierSku !== input.parsed.supplierSku) {
      const oldLabel = variantLabel({
        volumeValue: product.volumeValue,
        volumeUnit: product.volumeUnit,
      }) || "Основной";
      variants.push(
        makeImportedVariant({
          sku: product.supplierSku,
          label: oldLabel,
          price: product.price,
          stock: product.stock,
          image: product.image,
        }),
      );
    }

    const variantPrice = input.sourceOnly
      ? existingVariant?.price ?? input.parsed.sourcePrice
      : input.parsed.salePrice;
    const incoming = makeImportedVariant({
      sku: input.parsed.supplierSku,
      label,
      price: variantPrice,
      stock:
        existingVariant?.stock ??
        (product.supplierSku === input.parsed.supplierSku ? product.stock : 0),
      image: existingVariant?.image,
    });
    variants = mergeImportedVariant(variants, incoming);

    const positivePrices = variants.map((variant) => variant.price).filter((price) => price > 0);
    const nextPrice = positivePrices.length ? Math.min(...positivePrices) : product.price;
    const nextStock = variants.reduce((sum, variant) => sum + Math.max(0, variant.stock), 0);

    await input.tx.product.update({
      where: { id: product.id },
      data: {
        brandId: input.brandId,
        supplierId: input.supplierId,
        supplierSku: product.supplierSku || input.parsed.supplierSku,
        sourcePrice: input.parsed.sourcePrice,
        price: nextPrice,
        stock: nextStock,
        variants,
        priceListDate: parseSourceDate(input.parsed.sourceDate),
        lastImportedAt: new Date(),
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

  const nextPrice = input.sourceOnly ? product.price : input.parsed.salePrice;
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
  const parsedRowsForGrouping = priceImport.rows
    .map((row) => ParsedImportRowSchema.safeParse(row.parsedData))
    .filter((result) => result.success)
    .map((result) => result.data);
  const variantGroupKeys = autoVariantGroupKeys(parsedRowsForGrouping);
  const groupProductCache = new Map<string, string>();

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

      const groupKey = parsedProductGroupKey(parsed);
      const variantMode = Boolean(groupKey && variantGroupKeys.has(groupKey));

      const brandKey = normalizeBrandName(parsed.brand).toLocaleLowerCase("ru-RU");
      let brand = brandCache.get(brandKey);
      if (!brand) {
        brand = await ensureBrand(parsed.brand);
        brandCache.set(brandKey, brand);
      }

      const cachedProductId = groupKey ? groupProductCache.get(groupKey) : undefined;
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

      const matchedProduct = cachedProductId
        ? { id: cachedProductId }
        : row.productId
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
            variantMode,
          }),
        );

        if (groupKey && variantMode) groupProductCache.set(groupKey, productId);
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

      const groupedName = variantMode
        ? baseProductName(parsed.normalizedName, parsed.volumeLabel)
        : parsed.normalizedName;
      const baseSlug = slugify(
        `${brand.name}-${groupedName}-${variantMode ? parsed.supplierSku : parsed.volumeLabel || parsed.supplierSku}`,
      );
      const slug = await uniqueSlug({ model: "product", value: baseSlug });
      const initialPrice = sourceOnly ? parsed.sourcePrice : parsed.salePrice;
      const description = importedDescription(parsed.description) || "Описание готовится";
      const label = variantMode ? variantLabel(parsed) : "";

      const productId = await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name: groupedName,
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
            variants:
              variantMode && label
                ? [
                    makeImportedVariant({
                      sku: parsed.supplierSku,
                      label,
                      price: initialPrice,
                      stock: 0,
                    }),
                  ]
                : undefined,
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

      if (groupKey && variantMode) groupProductCache.set(groupKey, productId);
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

  return NextResponse.json({ import: updatedImport, autoVariantGroups: variantGroupKeys.size });
}
