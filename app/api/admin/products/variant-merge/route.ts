export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { EnrichmentProposalStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { productMergePlan } from "@/lib/productMergePlan";
import { isUsablePhoto } from "@/lib/enrichment/photoQuality";
import { photoSku } from "@/lib/enrichment/variantImages";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import {
  baseProductName,
  normalizeStoredVariants,
  productIdentityKey,
  variantLabel,
} from "@/lib/price-import/productVariants";
import { formatProductName, isAllCapsProductName } from "@/lib/productNames";

const MergeSchema = z.object({
  automatic: z.boolean().optional().default(false),
  canonicalId: z.string().min(1),
  productIds: z.array(z.string().min(1)).min(2).max(20),
});

function placeholderDescription(value: string) {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU");
  return !normalized || normalized === "описание готовится";
}

function productVariantLabel(product: {
  volumeValue: number | null;
  volumeUnit: string | null;
}) {
  return variantLabel({
    volumeValue: product.volumeValue,
    volumeUnit: product.volumeUnit,
  });
}

function productLineIdentity(product: {
  productLineCode: string | null;
  productLineName: string | null;
}) {
  return String(product.productLineCode || product.productLineName || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, "")
    .trim();
}

function productScore(product: {
  isPublished: boolean;
  image: string;
  description: string;
  variants: unknown;
  name: string;
  supplierId: string | null;
  isPopular: boolean;
  enrichmentProposals: Array<{ id: string; status: string }>;
}) {
  return (
    (product.enrichmentProposals.some(
      (proposal) => proposal.status === "APPLIED",
    )
      ? 1000
      : 0) +
    (product.supplierId ? 300 : 0) +
    (product.isPublished ? 200 : 0) +
    (product.isPopular ? 80 : 0) +
    normalizeStoredVariants(product.variants).length * 50 +
    (!product.image.startsWith("/seed/") ? 30 : 0) +
    (!placeholderDescription(product.description) ? 20 : 0) +
    (isAllCapsProductName(product.name) ? 0 : 10)
  );
}

const productSelect = {
  id: true,
  name: true,
  supplierId: true,
  supplierSku: true,
  brandId: true,
  price: true,
  stock: true,
  image: true,
  description: true,
  shortDescription: true,
  category: true,
  volumeValue: true,
  volumeUnit: true,
  productLineCode: true,
  productLineName: true,
  variants: true,
  isPopular: true,
  popularityPinned: true,
  popularityExcluded: true,
  popularityScore: true,
  popularityConfidence: true,
  popularityReason: true,
  popularityEvidence: true,
  popularityCheckedAt: true,
  isPublished: true,
  isNew: true,
  enrichmentStatus: true,
  createdAt: true,
  updatedAt: true,
  brand: { select: { name: true } },
  supplier: { select: { name: true } },
  enrichmentProposals: {
    where: {
      status: {
        in: [
          EnrichmentProposalStatus.PENDING,
          EnrichmentProposalStatus.APPLIED,
        ] as EnrichmentProposalStatus[],
      },
      confidence: { gt: 0 },
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true, status: true },
  },
} as const;

export async function GET(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const productId = new URL(req.url).searchParams.get("productId");
  const products = await prisma.product.findMany({
    where: {
      brandId: { not: null },
      enrichmentStatus: { not: "MERGED" },
    },
    orderBy: { createdAt: "asc" },
    select: productSelect,
  });

  const groups = new Map<string, typeof products>();
  for (const product of products) {
    const key = productIdentityKey({
      brandName: product.brand?.name,
      name: product.name,
      volumeValue: product.volumeValue,
      volumeUnit: product.volumeUnit,
    });
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(product);
    groups.set(key, list);
  }

  const candidates = [...groups.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([key, items]) => {
      const supplierIds = new Set(
        items.map((item) => item.supplierId).filter(Boolean),
      );
      if (supplierIds.size > 1) return null;
      const productLines = new Set(
        items.map(productLineIdentity).filter(Boolean),
      );
      if (productLines.size > 1) return null;

      if (productId && !items.some((item) => item.id === productId))
        return null;

      const sorted = [...items].sort(
        (a, b) => productScore(b) - productScore(a),
      );
      const canonical = sorted[0];
      let automatic = false;
      let warnings: string[] = [];
      let kind = "variants";
      try {
        const plan = productMergePlan(items, canonical.id);
        automatic = plan.automatic;
        warnings = plan.warnings;
        kind = plan.kind;
      } catch (error) {
        warnings = [
          mergeErrorMessage(
            error instanceof Error ? error.message : "merge_group_invalid",
          ),
        ];
      }
      if (items.length > 20) {
        automatic = false;
        warnings.push(
          "В группе больше 20 карточек. Объедините их меньшими группами в разделе объединения товаров.",
        );
      }
      return {
        automatic,
        warnings,
        kind,
        key,
        title: formatProductName(
          baseProductName(canonical.name, productVariantLabel(canonical)),
        ),
        supplier:
          items.find((item) => item.supplier?.name)?.supplier?.name || "",
        brand: canonical.brand?.name || "",
        suggestedCanonicalId: canonical.id,
        products: items.map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.supplierSku,
          label: productVariantLabel(item),
          price: item.price,
          stock: item.stock,
          image: item.image,
          isPublished: item.isPublished,
          enrichmentProposalStatus: item.enrichmentProposals[0]?.status || null,
          appliedEnrichment:
            item.enrichmentProposals[0]?.status ===
            EnrichmentProposalStatus.APPLIED,
          variants: normalizeStoredVariants(item.variants),
        })),
      };
    })
    .filter(Boolean);

  return NextResponse.json(candidates);
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = MergeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const productIds = [...new Set(parsed.data.productIds)];
  if (!productIds.includes(parsed.data.canonicalId)) {
    return NextResponse.json(
      { error: "canonical_not_in_group" },
      { status: 400 },
    );
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: productSelect,
  });
  if (products.length !== productIds.length) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  const canonical = products.find(
    (product) => product.id === parsed.data.canonicalId,
  )!;
  if (!canonical.brandId || !canonical.brand?.name) {
    return NextResponse.json({ error: "merge_group_invalid" }, { status: 409 });
  }

  const supplierIds = [
    ...new Set(
      products
        .map((product) => product.supplierId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (supplierIds.length > 1) {
    return NextResponse.json(
      { error: "products_have_different_suppliers" },
      { status: 409 },
    );
  }
  const mergeSupplierId = supplierIds[0] || null;
  const productLines = new Set(
    products.map(productLineIdentity).filter(Boolean),
  );
  if (productLines.size > 1) {
    return NextResponse.json(
      { error: "products_have_different_product_lines" },
      { status: 409 },
    );
  }

  const expectedGroup = productIdentityKey({
    brandName: canonical.brand.name,
    name: canonical.name,
    volumeValue: canonical.volumeValue,
    volumeUnit: canonical.volumeUnit,
  });

  for (const product of products) {
    const group = productIdentityKey({
      brandName: product.brand?.name,
      name: product.name,
      volumeValue: product.volumeValue,
      volumeUnit: product.volumeUnit,
    });
    if (
      !group ||
      group !== expectedGroup ||
      (product.supplierId !== null && product.supplierId !== mergeSupplierId) ||
      product.brandId !== canonical.brandId ||
      product.enrichmentStatus === "MERGED"
    ) {
      return NextResponse.json(
        { error: "products_not_same_variant_group" },
        { status: 409 },
      );
    }
  }

  let plan: ReturnType<typeof productMergePlan>;
  try {
    plan = productMergePlan(products, canonical.id);
    if (parsed.data.automatic && !plan.automatic)
      return NextResponse.json(
        { error: "merge_review_required", message: plan.warnings.join(" ") },
        { status: 409 },
      );
  } catch (error) {
    return NextResponse.json(
      {
        error: "merge_group_invalid",
        message: mergeErrorMessage(
          error instanceof Error ? error.message : "merge_group_invalid",
        ),
      },
      { status: 409 },
    );
  }
  const { variants, orderMappings } = plan;

  const describedProduct = products.find(
    (product) => !placeholderDescription(product.description),
  );
  const positivePrices = variants
    .map((variant) => variant.price)
    .filter((price) => price > 0);
  const nextPrice = positivePrices.length
    ? Math.min(...positivePrices)
    : canonical.price;
  const nextStock = variants.reduce((sum, variant) => sum + variant.stock, 0);
  const canonicalLabel = productVariantLabel(canonical);
  const nextName = formatProductName(
    baseProductName(canonical.name, canonicalLabel),
  );
  const duplicateIds = products
    .filter((product) => product.id !== canonical.id)
    .map((product) => product.id);
  const primarySku =
    canonical.supplierSku ||
    variants.find((variant) => variant.sku)?.sku ||
    null;
  const popularitySource = [...products].sort(
    (left, right) =>
      right.popularityScore - left.popularityScore ||
      right.popularityConfidence - left.popularityConfidence,
  )[0];

  try {
    await prisma.$transaction(
      async (tx) => {
        const activeJob = await tx.enrichmentJob.findFirst({
          where: {
            productId: { in: productIds },
            status: { in: ["PENDING", "RUNNING"] },
          },
          select: { id: true },
        });
        if (activeJob) throw new Error("enrichment_already_running");
        // Сначала освобождаем supplierSku архивируемых дублей. Иначе, если основной
        // товар получает SKU одного из них, PostgreSQL справедливо возмутится unique-index.
        for (const id of duplicateIds) {
          const original = products.find((product) => product.id === id)!;
          const archived = await tx.product.updateMany({
            where: {
              id,
              updatedAt: original.updatedAt,
              enrichmentStatus: { notIn: ["MERGED", "RUNNING"] },
            },
            data: {
              isPublished: false,
              stock: 0,
              supplierSku: null,
              enrichmentStatus: "MERGED",
              isPopular: false,
              popularityPinned: false,
              popularityExcluded: false,
            },
          });
          if (archived.count !== 1) throw new Error("product_changed_refresh");
        }

        const written = await tx.product.updateMany({
          where: {
            id: canonical.id,
            updatedAt: canonical.updatedAt,
            enrichmentStatus: { notIn: ["MERGED", "RUNNING"] },
          },
          data: {
            name: nextName,
            supplierId: mergeSupplierId,
            supplierSku: primarySku,
            price: nextPrice,
            stock: nextStock,
            variants,
            // The pre-merge suggestions below are rejected, so no review remains.
            enrichmentStatus:
              canonical.enrichmentStatus === "REVIEW"
                ? "READY"
                : canonical.enrichmentStatus,
            image: isUsablePhoto(canonical.image)
              ? canonical.image
              : variants.find(
                  (variant) =>
                    photoSku(variant.sku) === photoSku(primarySku) &&
                    isUsablePhoto(variant.image),
                )?.image || canonical.image,
            shortDescription:
              canonical.shortDescription?.trim() ||
              products.find((product) => product.shortDescription?.trim())
                ?.shortDescription ||
              null,
            description: describedProduct?.description || canonical.description,
            isPublished: products.some((product) => product.isPublished),
            isPopular: products.some((product) => product.isPopular),
            popularityPinned: products.some(
              (product) => product.popularityPinned,
            ),
            popularityExcluded:
              !products.some((product) => product.popularityPinned) &&
              products.every((product) => product.popularityExcluded),
            popularityScore: popularitySource?.popularityScore || 0,
            popularityConfidence: popularitySource?.popularityConfidence || 0,
            popularityReason: popularitySource?.popularityReason || null,
            popularityEvidence:
              popularitySource?.popularityEvidence == null
                ? Prisma.JsonNull
                : popularitySource.popularityEvidence,
            popularityCheckedAt: popularitySource?.popularityCheckedAt || null,
            isNew: products.some((product) => product.isNew),
          },
        });

        if (written.count !== 1) throw new Error("product_changed_refresh");
        for (const mapping of orderMappings) {
          await tx.orderItem.updateMany({
            where: {
              productId: mapping.productId,
              variantId: mapping.fromVariantId,
            },
            data: { productId: canonical.id, variantId: mapping.variantId },
          });
        }

        // All pending suggestions describe the pre-merge variant set; search it afresh.
        await tx.productEnrichmentProposal.updateMany({
          where: { productId: { in: productIds }, status: "PENDING" },
          data: { status: "REJECTED" },
        });
        await tx.enrichmentJob.updateMany({
          where: { productId: { in: productIds }, status: "REVIEW" },
          data: { status: "CANCELED", finishedAt: new Date() },
        });
        if (duplicateIds.length) {
          await tx.orderItem.updateMany({
            where: { productId: { in: duplicateIds } },
            data: { productId: canonical.id },
          });
          await tx.priceImportRow.updateMany({
            where: { productId: { in: duplicateIds } },
            data: { productId: canonical.id },
          });
        }
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "merge_failed",
        message: mergeErrorMessage(
          error instanceof Error ? error.message : "merge_failed",
        ),
      },
      { status: 409 },
    );
  }

  const result = await prisma.product.findUnique({
    where: { id: canonical.id },
    include: { brand: true, supplier: true },
  });

  return NextResponse.json({
    product: result,
    mergedProductIds: duplicateIds,
  });
}

function mergeErrorMessage(code: string) {
  const messages: Record<string, string> = {
    variant_label_missing:
      "Не указан объём или SKU товара. Уточните карточки перед объединением.",
    sku_volume_conflict:
      "Одинаковый SKU указан для разных объёмов. Исправьте SKU или фасовку.",
    variant_volume_ambiguous:
      "У одинаковой фасовки разные SKU. Уточните названия вариантов перед объединением.",
    enrichment_already_running:
      "Поиск данных ещё выполняется. Дождитесь завершения и повторите объединение.",
    product_changed_refresh:
      "Товар изменился во время объединения. Обновите карточку.",
  };
  return (
    messages[code] ||
    "Не удалось объединить карточки. Обновите список и проверьте товары."
  );
}
