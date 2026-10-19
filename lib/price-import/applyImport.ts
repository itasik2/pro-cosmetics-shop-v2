import {
  ImportRowAction,
  PriceImportStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ParsedImportRowSchema,
  type ParsedImportRow,
} from "@/lib/price-import/parsedRow";
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
import { photoSku } from "@/lib/enrichment/variantImages";
import { isUsablePhoto } from "@/lib/enrichment/photoQuality";
import { comparePriceImportDate } from "./dateGuard";
import {
  priceImportContext,
  pricePolicyProductSelect,
  readPriceImport,
} from "./reconciliation";
import {
  dateBlock,
  decidePriceRow,
  objectData,
  type PriceDecision,
} from "./reconciliationPolicy";
import {
  removedVariantSkus,
  shouldSkipRemovedVariant,
} from "@/lib/enrichment/removedVariants";

function normalizeBrandName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSku(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

function importedDescription(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureBrand(
  name: string,
  database: typeof prisma,
  makeSlug: typeof uniqueSlug,
) {
  const normalizedName = normalizeBrandName(name);
  if (!normalizedName) throw new Error("brand_required");

  const baseSlug = slugify(normalizedName);
  if (!baseSlug) throw new Error("brand_slug_empty");

  const existing = await database.brand.findFirst({
    where: {
      OR: [
        { slug: baseSlug },
        { name: { equals: normalizedName, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
  });

  if (existing) {
    await database.brand.update({
      where: { id: existing.id },
      data: { isActive: true },
    });
    return existing;
  }

  const slug = await makeSlug({ model: "brand", value: baseSlug });
  return database.brand.create({
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
  automatic?: boolean;
  effectiveDate: Date;
  guard: (
    product: Prisma.ProductGetPayload<{
      select: typeof pricePolicyProductSelect;
    }>,
  ) => Promise<PriceDecision>;
}) {
  const product = await input.tx.product.findUnique({
    where: { id: input.productId },
    select: pricePolicyProductSelect,
  });

  if (!product) throw new Error("product_not_found");
  const decision = await input.guard(product);

  const exactSkuMatch = productOwnsSku(product, input.parsed.supplierSku || "");
  if (!exactSkuMatch && !input.variantMode)
    throw new Error("variant_sku_not_found");
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

  // Converting an existing card into variants must retain its local stock and photo.
  if (useVariants && !storedVariants.length && product.supplierSku) {
    storedVariants.push(
      makeImportedVariant({
        sku: product.supplierSku,
        label:
          variantLabel(product) ||
          (exactSkuMatch ? variantLabel(input.parsed) : "") ||
          "Стандартный",
        price: product.price,
        stock: product.stock,
        image: isUsablePhoto(product.image) ? product.image : null,
      }),
    );
  }

  if (useVariants) {
    const sku = input.parsed.supplierSku || "";
    const existingVariant = findVariantBySku(storedVariants, sku);
    let variants = [...storedVariants];

    if (existingVariant) {
      variants = variants.map((variant) =>
        normalizeSku(variant.sku) === normalizeSku(sku)
          ? {
              ...variant,
              ...(!input.automatic &&
              !variant.image &&
              input.parsed.priceImageUrl
                ? { image: input.parsed.priceImageUrl }
                : {}),
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
          image: input.parsed.priceImageUrl,
          label,
          price: input.sourceOnly
            ? input.parsed.sourcePrice
            : input.parsed.salePrice,
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
      where: { id: product.id, updatedAt: product.updatedAt },
      data: {
        ...(rebrand ? { brandId: input.incomingBrandId } : {}),
        sourcePrice: input.parsed.sourcePrice,
        price: nextPrice,
        variants,
        ...(decision.wasNew ? { isNew: true } : {}),
        priceListDate: input.effectiveDate,
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

    return { productId: product.id, rebrand, decision };
  }

  const nextPrice = input.sourceOnly ? product.price : input.parsed.salePrice;
  await input.tx.product.update({
    where: { id: product.id, updatedAt: product.updatedAt },
    data: {
      ...(rebrand ? { brandId: input.incomingBrandId } : {}),
      sourcePrice: input.parsed.sourcePrice,
      price: nextPrice,
      priceListDate: input.effectiveDate,
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

  return { productId: product.id, rebrand, decision };
}

export type PriceDecreaseApproval = {
  rowId: string;
  previousPrice: number;
  nextPrice: number;
};
export async function applyPriceImport(
  input: {
    importId: string;
    automatic?: boolean;
    approvedDecreases?: PriceDecreaseApproval[];
  },
  dependencies: { database?: typeof prisma; makeSlug?: typeof uniqueSlug } = {},
) {
  const database = dependencies.database || prisma;
  const makeSlug = dependencies.makeSlug || uniqueSlug;
  const context = await priceImportContext(input.importId, database);
  if (!context) throw new Error("import_not_found");

  const priceImport = await database.priceImport.findUnique({
    where: { id: input.importId },
    include: {
      supplier: true,
      rows: {
        where: { selected: true, appliedAt: null },
        orderBy: [{ pageNumber: "asc" }, { rowNumber: "asc" }],
      },
    },
  });

  if (!priceImport) {
    throw new Error("import_not_found");
  }
  if (priceImport.status !== PriceImportStatus.REVIEW) {
    return {
      import: await readPriceImport(input.importId, database),
      autoVariantGroups: 0,
      rebrandedRows: 0,
    };
  }
  const blocked = dateBlock(
    priceImport.sourceDate,
    context.dateComparison.currentSourceDate,
  );
  if (blocked)
    throw new Error(
      blocked === "OLDER"
        ? "price_import_older"
        : blocked === "FUTURE"
          ? "price_import_future"
          : "price_import_date_required",
    );
  const effectiveDate = priceImport.sourceDate!;

  const sourceOnly =
    normalizePriceMode(priceImport.priceMode) === "SOURCE_ONLY";
  const brandCache = new Map<string, { id: string; name: string }>();
  const parsedRowsForGrouping = context.priceImport.rows
    .map((row) => ParsedImportRowSchema.safeParse(row.parsedData))
    .filter((result) => result.success)
    .map((result) => result.data);
  const variantGroupKeys = autoVariantGroupKeys(parsedRowsForGrouping);
  const groupProductCache = new Map<string, string>();

  const supplierProducts = await database.product.findMany({
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
      ...normalizeStoredVariants(product.variants).map(
        (variant) => variant.sku || null,
      ),
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
  const exclusions = await database.productEnrichmentProposal.findMany({
    where: {
      productId: { in: supplierProducts.map((product) => product.id) },
      facts: { path: ["removedVariantSkus"], array_contains: [] },
    },
    select: { productId: true, facts: true },
  });
  const removedOwners = new Map(
    exclusions.flatMap((row) =>
      removedVariantSkus(row.facts).map((sku) => [sku, row.productId] as const),
    ),
  );
  const excludedSkus = new Set(removedOwners.keys());
  const activeSkus = new Set(skuCandidates.keys());

  let rebrandedRows = 0;

  let attempted = 0;
  for (const row of priceImport.rows) {
    const initialDecision = context.decisions.get(row.id)!;
    if (
      input.automatic &&
      !["INCREASE", "UNCHANGED"].includes(initialDecision.kind)
    )
      continue;
    if (input.automatic && ++attempted > 100) break;
    if (
      row.action === ImportRowAction.SKIP ||
      row.action === ImportRowAction.ERROR ||
      row.action === ImportRowAction.MANUAL_REVIEW
    ) {
      continue;
    }

    try {
      const parsed = ParsedImportRowSchema.parse(row.parsedData);
      if (!parsed.supplierSku) throw new Error("sku_required_for_apply");
      if (
        shouldSkipRemovedVariant(parsed.supplierSku, excludedSkus, activeSkus)
      ) {
        await database.priceImportRow.update({
          where: { id: row.id },
          data: {
            action: ImportRowAction.SKIP,
            productId: removedOwners.get(normalizeSku(parsed.supplierSku)),
            error:
              "Вариант ранее удалён администратором и исключён из автодобавления.",
          },
        });
        continue;
      }

      const groupKey = parsedProductGroupKey(parsed);
      const variantMode =
        !input.automatic && Boolean(groupKey && variantGroupKeys.has(groupKey));
      const brandKey = normalizeBrandName(parsed.brand).toLocaleLowerCase(
        "ru-RU",
      );
      let brand = brandCache.get(brandKey);
      if (!brand) {
        const existing = input.automatic
          ? context.products.find((product) => product.id === row.productId)
          : null;
        brand = existing?.brandId
          ? { id: existing.brandId, name: parsed.brand }
          : await ensureBrand(parsed.brand, database, makeSlug);
        brandCache.set(brandKey, brand);
      }

      const cachedProductId = groupKey
        ? groupProductCache.get(groupKey)
        : undefined;
      const skuProductId = uniqueProductBySku.get(
        normalizeSku(parsed.supplierSku),
      );
      const matchedProductId = cachedProductId || row.productId || skuProductId;

      if (matchedProductId) {
        const result = await database.$transaction(
          async (tx) => {
            const freshImport = await tx.priceImport.findUnique({
              where: { id: priceImport.id },
              select: { sourceDate: true, status: true },
            });
            if (
              !freshImport ||
              freshImport.status !== "REVIEW" ||
              freshImport.sourceDate?.getTime() !== effectiveDate.getTime()
            )
              throw new Error("price_row_changed");
            const freshRow = await tx.priceImportRow.findUniqueOrThrow({
              where: { id: row.id },
            });
            if (freshRow.appliedAt) return null;
            if (!freshRow.selected || freshRow.action !== row.action)
              throw new Error("price_row_changed");
            const result = await updateExistingPrice({
              tx,
              productId: matchedProductId,
              parsed,
              importId: priceImport.id,
              incomingBrandId: brand.id,
              sourceOnly,
              variantMode,
              automatic: input.automatic,
              effectiveDate,
              guard: async (product) => {
                const comparison = await comparePriceImportDate(
                  {
                    supplierId: priceImport.supplierId,
                    sourceDate: effectiveDate,
                    excludeImportId: priceImport.id,
                  },
                  tx,
                );
                const decision = decidePriceRow({
                  row: freshRow,
                  products: [
                    ...context.products.filter(
                      (item) => item.id !== product.id,
                    ),
                    product,
                  ],
                  sourceDate: effectiveDate,
                  baselineDate: comparison.currentSourceDate,
                  priceMode: priceImport.priceMode,
                  previous: context.previousBySku.get(
                    photoSku(parsed.supplierSku),
                  ),
                  previousSourceDate: context.previousSourceDate,
                  duplicateSku: context.duplicates.has(
                    photoSku(parsed.supplierSku),
                  ),
                  pricingChanged: context.pricingChanged,
                });
                if (["OLDER", "NO_DATE", "FUTURE"].includes(decision.kind))
                  throw new Error("price_import_older");
                if (
                  input.automatic &&
                  !["INCREASE", "UNCHANGED"].includes(decision.kind)
                )
                  throw new Error("price_row_changed");
                const currentVariant = findVariantBySku(
                  normalizeStoredVariants(product.variants),
                  parsed.supplierSku,
                );
                const previousPrice = sourceOnly
                  ? normalizeStoredVariants(product.variants).length
                    ? (context.previousBySku.get(photoSku(parsed.supplierSku))
                        ?.sourcePrice ?? null)
                    : product.sourcePrice
                  : (currentVariant?.price ??
                    (productOwnsSku(product, parsed.supplierSku || "")
                      ? product.price
                      : null));
                const nextPrice = sourceOnly
                  ? parsed.sourcePrice
                  : parsed.salePrice;
                if (
                  previousPrice !== null &&
                  nextPrice < previousPrice &&
                  !input.approvedDecreases?.some(
                    (approval) =>
                      approval.rowId === row.id &&
                      approval.previousPrice === previousPrice &&
                      approval.nextPrice === nextPrice,
                  )
                )
                  throw new Error("price_decrease_confirmation_required");
                return { ...decision, previousPrice, nextPrice };
              },
            });
            await tx.priceImportRow.update({
              where: { id: row.id },
              data: {
                productId: result.productId,
                action: ImportRowAction.UPDATE,
                selected: false,
                appliedAt: new Date(),
                error: null,
                rawData: {
                  ...objectData(freshRow.rawData),
                  priceDecision: {
                    ...result.decision,
                    automatic: Boolean(input.automatic),
                  },
                } as Prisma.InputJsonValue,
              },
            });
            return result;
          },
          { isolationLevel: "Serializable" },
        );
        if (!result) continue;

        if (result.rebrand) rebrandedRows += 1;
        if (groupKey && variantMode) {
          groupProductCache.set(groupKey, result.productId);
        }
        uniqueProductBySku.set(
          normalizeSku(parsed.supplierSku),
          result.productId,
        );
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
      const slug = await makeSlug({ model: "product", value: baseSlug });
      const initialPrice = sourceOnly ? parsed.sourcePrice : parsed.salePrice;
      const description =
        importedDescription(parsed.description) || "Описание готовится";
      const label = variantMode ? variantLabel(parsed) : "";

      const productId = await database.$transaction(
        async (tx) => {
          const freshImport = await tx.priceImport.findUnique({
            where: { id: priceImport.id },
            select: { sourceDate: true, status: true },
          });
          if (
            !freshImport ||
            freshImport.status !== "REVIEW" ||
            freshImport.sourceDate?.getTime() !== effectiveDate.getTime()
          )
            throw new Error("price_row_changed");
          const freshRow = await tx.priceImportRow.findUniqueOrThrow({
            where: { id: row.id },
          });
          if (
            freshRow.appliedAt ||
            !freshRow.selected ||
            freshRow.action !== row.action
          )
            throw new Error("price_row_changed");
          const comparison = await comparePriceImportDate(
            {
              supplierId: priceImport.supplierId,
              sourceDate: effectiveDate,
              excludeImportId: priceImport.id,
            },
            tx,
          );
          if (dateBlock(effectiveDate, comparison.currentSourceDate))
            throw new Error("price_import_older");
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
              priceListDate: effectiveDate,
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
                        image: parsed.priceImageUrl,
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
          await tx.priceImportRow.update({
            where: { id: row.id },
            data: {
              productId: product.id,
              action: ImportRowAction.CREATE,
              selected: false,
              appliedAt: new Date(),
              error: null,
              rawData: {
                ...objectData(freshRow.rawData),
                priceDecision: {
                  ...initialDecision,
                  wasNew: true,
                  automatic: false,
                },
              } as Prisma.InputJsonValue,
            },
          });
          return product.id;
        },
        { isolationLevel: "Serializable" },
      );

      if (groupKey && variantMode) groupProductCache.set(groupKey, productId);
      uniqueProductBySku.set(normalizeSku(parsed.supplierSku), productId);
    } catch (error: any) {
      const reviewMessages: Record<string, string> = {
        price_decrease_confirmation_required:
          "Снижение не подтверждено или цена изменилась. Проверьте актуальные суммы и подтвердите снова.",
        price_row_changed:
          "Позиция изменилась во время применения. Проверьте её повторно.",
        price_import_older:
          "Появился более свежий прайс. Эта цена не применена.",
        P2034:
          "Параллельное изменение. Позиция сохранена для повторной проверки.",
        P2025: "Товар изменился во время применения. Проверьте цену повторно.",
      };
      const reviewMessage =
        reviewMessages[error?.code] || reviewMessages[error?.message];
      if (reviewMessage) {
        await database.priceImportRow.updateMany({
          where: { id: row.id, appliedAt: null },
          data: { selected: false, error: reviewMessage },
        });
        continue;
      }
      await database.priceImportRow.updateMany({
        where: { id: row.id, appliedAt: null },
        data: {
          action: ImportRowAction.ERROR,
          selected: false,
          error: String(error?.message || "row_apply_failed").slice(0, 500),
        },
      });
    }
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await database.$transaction(
        async (tx) => {
          const finalRows = await tx.priceImportRow.findMany({
            where: { importId: priceImport.id },
          });
          const remaining = finalRows.some(
            (row) =>
              !row.appliedAt && row.action !== "SKIP" && row.action !== "ERROR",
          );
          await tx.priceImport.update({
            where: { id: priceImport.id },
            data: {
              status: remaining
                ? PriceImportStatus.REVIEW
                : PriceImportStatus.APPLIED,
              appliedAt: remaining ? null : new Date(),
              createdRows: finalRows.filter(
                (row) => row.appliedAt && row.action === "CREATE",
              ).length,
              updatedRows: finalRows.filter(
                (row) => row.appliedAt && row.action === "UPDATE",
              ).length,
              skippedRows: finalRows.filter((row) => row.action === "SKIP")
                .length,
              errorRows: finalRows.filter((row) => row.action === "ERROR")
                .length,
            },
          });
        },
        { isolationLevel: "Serializable" },
      );
      break;
    } catch (error) {
      if (attempt >= 2 || (error as { code?: string }).code !== "P2034")
        throw error;
    }
  }

  return {
    import: await readPriceImport(priceImport.id, database),
    autoVariantGroups: variantGroupKeys.size,
    rebrandedRows,
  };
}
