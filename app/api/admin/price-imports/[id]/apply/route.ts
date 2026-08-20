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
  normalizeStoredVariants,
  parsedProductGroupKey,
  variantLabel,
} from "@/lib/price-import/productVariants";
import { formatProductName } from "@/lib/productNames";
import { slugify } from "@/lib/slug";
import { uniqueSlug } from "@/lib/uniqueSlug";

type Params = { params: { id: string } };

function parseSourceDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function normalizeBrandName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSku(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}

function importedDescription(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function productOwnsSku(
  product: { supplierSku: string | null; variants: unknown },
  sku: string,
) {
  const key = normalizeSku(sku);
  if (!key) return false;
  if (normalizeSku(product.supplierSku) === key) return true;
  return normalizeStoredVariants(product.variants).some(
    (variant) => normalizeSku(variant.sku) === key,
  );
}

async function updateExistingPrice(input: {
  tx: Prisma.TransactionClient;
  productId: string;
  parsed: ParsedImportRow;
  importId: string;
  incomingBrandId: string;
  sourceOnly: boolean;
  variantMode: boolean;
}) {
  const product = await input.tx.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      brandId: true,
      supplierSku: true,
      price: true,
      sourcePrice: true,
      stock: true,
      image: true,
      variants: true,
      volumeValue: true,
      volumeUnit: true,
    },
  });

  if (!product) throw new Error("product_not_found");

  const exactSkuMatch = productOwnsSku(product, input.parsed.supplierSku || "");
  const rebrand =
    Boolean(product.brandId) &&
    product.brandId !== input.incomingBrandId &&
    exactSkuMatch;

  if (
    product.brandId &&
    product.brandId !== input.incomingBrandId &&
    !exactSkuMatch
  ) {
    throw new Error("brand_mismatch_requires_exact_sku");
  }

  const storedVariants = normalizeStoredVariants(product.variants);
  const useVariants = input.variantMode || storedVariants.length > 0;

  if (useVariants) {
    const sku = input.parsed.supplierSku || "";
    const existingVariant = findVariantBySku(storedVariants, sku);
    let variants = [...storedVariants];

    if (existingVariant) {
      variants = variants.map((variant) =>
        normalizeSku(variant.sku) === normalizeSku(sku)
          ? {
              ...variant,
              price: input.sourceOnly ? variant.price : input.parsed.salePrice,
            }
          : variant,
      );
    } else {
      if (!input.variantMode) throw new Error("variant_sku_not_found");
      const label = variantLabel(input.parsed);
      if (!label) throw new Error("variant_label_required");
      variants.push(
        makeImportedVariant({
          sku,
          label,
          price: input.sourceOnly ? input.parsed.sourcePrice : input.parsed.salePrice,
          stock: 0,
        }),
      );
    }

    const positivePrices = variants
      .map((variant) => variant.price)
      .filter((price) => price > 0);
    const nextPrice = positivePrices.length
      ? Math.min(...positivePrices)
      : product.price;

    await input.tx.product.update({
      where: { id: product.id },
      data: {
        ...(rebrand ? { brandId: input.incomingBrandId } : {}),
        sourcePrice: input.parsed.sourcePrice,
        price: nextPrice,
        variants,
        priceListDate: parseSourceDate(input.parsed.sourceDate),
        lastImportedAt: new Date(),
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

    return { productId: product.id, rebrand };
  }

  const nextPrice = input.sourceOnly ? product.price : input.parsed.salePrice;
  await input.tx.product.update({
    where: { id: product.id },
    data: {
      ...(rebrand ? { brandId: input.incomingBrandId } : {}),
      sourcePrice: input.parsed.sourcePrice,
      price: nextPrice,
      priceListDate: parseSourceDate(input.parsed.sourceDate),
      lastImportedAt: new Date(),
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

  return { productId: product.id, rebrand };
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

  const supplierProducts = await prisma.product.findMany({
    where: {
      supplierId: priceImport.supplierId,
      enrichmentStatus: { not: "MERGED" },
    },
    select: {
      id: true,
      supplierSku: true,
      variants: true,
    },
  });
  const skuCandidates = new Map<string, Set<string>>();
  for (const product of supplierProducts) {
    const skus = [
      product.supplierSku,
      ...normalizeStoredVariants(product.variants).map((variant) => variant.sku || null),
    ];
    for (const sku of skus) {
      const key = normalizeSku(sku);
      if (!key) continue;
      const ids = skuCandidates.get(key) ?? new Set<string>();
      ids.add(product.id);
      skuCandidates.set(key, ids);
    }
  }
  const uniqueProductBySku = new Map<string, string>();
  for (const [sku, ids] of skuCandidates) {
    if (ids.size === 1) uniqueProductBySku.set(sku, [...ids][0]);
  }

  let createdRows = 0;
  let updatedRows = 0;
  let skippedRows = 0;
  let errorRows = 0;
  let rebrandedRows = 0;

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
      if (!parsed.supplierSku) throw new Error("sku_required_for_apply");

      const groupKey = parsedProductGroupKey(parsed);
      const variantMode = Boolean(groupKey && variantGroupKeys.has(groupKey));
      const brandKey = normalizeBrandName(parsed.brand).toLocaleLowerCase("ru-RU");
      let brand = brandCache.get(brandKey);
      if (!brand) {
        brand = await ensureBrand(parsed.brand);
        brandCache.set(brandKey, brand);
      }

      const cachedProductId = groupKey ? groupProductCache.get(groupKey) : undefined;
      const skuProductId = uniqueProductBySku.get(normalizeSku(parsed.supplierSku));
      const matchedProductId = cachedProductId || row.productId || skuProductId;

      if (matchedProductId) {
        const result = await prisma.$transaction((tx) =>
          updateExistingPrice({
            tx,
            productId: matchedProductId,
            parsed,
            importId: priceImport.id,
            incomingBrandId: brand.id,
            sourceOnly,
            variantMode,
          }),
        );

        if (result.rebrand) rebrandedRows += 1;
        if (groupKey && variantMode) {
          groupProductCache.set(groupKey, result.productId);
        }
        uniqueProductBySku.set(normalizeSku(parsed.supplierSku), result.productId);
        await prisma.priceImportRow.update({
          where: { id: row.id },
          data: {
            productId: result.productId,
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
            name: formatProductName(groupedName),
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
      uniqueProductBySku.set(normalizeSku(parsed.supplierSku), productId);
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

  return NextResponse.json({
    import: updatedImport,
    autoVariantGroups: variantGroupKeys.size,
    rebrandedRows,
  });
}
