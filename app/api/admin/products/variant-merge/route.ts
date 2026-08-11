export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import {
  baseProductName,
  existingProductGroupKey,
  makeImportedVariant,
  mergeImportedVariant,
  normalizeStoredVariants,
  variantLabel,
} from "@/lib/price-import/productVariants";

const MergeSchema = z.object({
  canonicalId: z.string().min(1),
  productIds: z.array(z.string().min(1)).min(2).max(20),
});

function placeholderDescription(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU");
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

function productScore(product: {
  isPublished: boolean;
  image: string;
  description: string;
  variants: unknown;
  enrichmentProposals: Array<{ id: string }>;
}) {
  return (
    (product.enrichmentProposals.length ? 1000 : 0) +
    (product.isPublished ? 200 : 0) +
    normalizeStoredVariants(product.variants).length * 50 +
    (!product.image.startsWith("/seed/") ? 30 : 0) +
    (!placeholderDescription(product.description) ? 20 : 0)
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
  category: true,
  volumeValue: true,
  volumeUnit: true,
  productLineCode: true,
  productLineName: true,
  variants: true,
  isPublished: true,
  isNew: true,
  enrichmentStatus: true,
  createdAt: true,
  brand: { select: { name: true } },
  supplier: { select: { name: true } },
  enrichmentProposals: {
    where: { status: "APPLIED" as const },
    take: 1,
    select: { id: true },
  },
} as const;

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const products = await prisma.product.findMany({
    where: {
      supplierId: { not: null },
      brandId: { not: null },
      enrichmentStatus: { not: "MERGED" },
    },
    orderBy: { createdAt: "asc" },
    select: productSelect,
  });

  const groups = new Map<string, typeof products>();
  for (const product of products) {
    const productKey = existingProductGroupKey({
      brandName: product.brand?.name,
      name: product.name,
      category: product.category,
      productLineCode: product.productLineCode,
      productLineName: product.productLineName,
      volumeValue: product.volumeValue,
      volumeUnit: product.volumeUnit,
    });
    if (!productKey || !product.supplierId) continue;
    const key = `${product.supplierId}|${productKey}`;
    const list = groups.get(key) ?? [];
    list.push(product);
    groups.set(key, list);
  }

  const candidates = [...groups.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([key, items]) => {
      const labels = new Set(
        items
          .flatMap((item) => {
            const variants = normalizeStoredVariants(item.variants);
            if (variants.length) {
              return variants.map((variant) => variant.label.toLocaleLowerCase("ru-RU"));
            }
            const label = productVariantLabel(item);
            return label ? [label.toLocaleLowerCase("ru-RU")] : [];
          })
          .filter(Boolean),
      );
      if (labels.size < 2) return null;

      const sorted = [...items].sort((a, b) => productScore(b) - productScore(a));
      const canonical = sorted[0];
      return {
        key,
        title: baseProductName(canonical.name, productVariantLabel(canonical)),
        supplier: canonical.supplier?.name || "",
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
          appliedEnrichment: item.enrichmentProposals.length > 0,
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
    return NextResponse.json({ error: "canonical_not_in_group" }, { status: 400 });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: productSelect,
  });
  if (products.length !== productIds.length) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  const canonical = products.find((product) => product.id === parsed.data.canonicalId)!;
  if (!canonical.supplierId || !canonical.brandId || !canonical.brand?.name) {
    return NextResponse.json({ error: "merge_group_invalid" }, { status: 409 });
  }

  const expectedGroup = existingProductGroupKey({
    brandName: canonical.brand.name,
    name: canonical.name,
    category: canonical.category,
    productLineCode: canonical.productLineCode,
    productLineName: canonical.productLineName,
    volumeValue: canonical.volumeValue,
    volumeUnit: canonical.volumeUnit,
  });

  for (const product of products) {
    const group = existingProductGroupKey({
      brandName: product.brand?.name,
      name: product.name,
      category: product.category,
      productLineCode: product.productLineCode,
      productLineName: product.productLineName,
      volumeValue: product.volumeValue,
      volumeUnit: product.volumeUnit,
    });
    if (
      !group ||
      group !== expectedGroup ||
      product.supplierId !== canonical.supplierId ||
      product.brandId !== canonical.brandId ||
      product.enrichmentStatus === "MERGED"
    ) {
      return NextResponse.json(
        { error: "products_not_same_variant_group" },
        { status: 409 },
      );
    }
  }

  let variants = normalizeStoredVariants(canonical.variants);
  // Для простой старой карточки заказ не содержит variantId, поэтому запоминаем
  // созданный вариант. У карточки, где варианты уже были, существующий variantId
  // заказа сохраняем без изменений.
  const simpleProductVariantIds = new Map<string, string>();

  for (const product of products) {
    const stored = normalizeStoredVariants(product.variants);
    if (stored.length) {
      for (const variant of stored) {
        variants = mergeImportedVariant(variants, variant);
      }
      continue;
    }

    const label = productVariantLabel(product);
    if (!label) {
      return NextResponse.json(
        {
          error: "variant_label_missing",
          productId: product.id,
          productName: product.name,
        },
        { status: 409 },
      );
    }
    const variant = makeImportedVariant({
      sku: product.supplierSku,
      label,
      price: product.price,
      stock: product.stock,
      image: product.image.startsWith("/seed/") ? null : product.image,
    });
    variants = mergeImportedVariant(variants, variant);
    simpleProductVariantIds.set(product.id, variant.id);
  }

  const labels = new Set(
    variants.map((variant) => variant.label.toLocaleLowerCase("ru-RU")),
  );
  if (labels.size < 2) {
    return NextResponse.json(
      { error: "not_enough_distinct_variants" },
      { status: 409 },
    );
  }

  const realImageProduct = products.find(
    (product) => !product.image.startsWith("/seed/"),
  );
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
  const nextName = baseProductName(canonical.name, canonicalLabel);
  const duplicateIds = products
    .filter((product) => product.id !== canonical.id)
    .map((product) => product.id);
  const primarySku =
    canonical.supplierSku || variants.find((variant) => variant.sku)?.sku || null;

  await prisma.$transaction(async (tx) => {
    // Сначала освобождаем supplierSku архивируемых дублей. Иначе, если основной
    // товар получает SKU одного из них, PostgreSQL справедливо возмутится unique-index.
    for (const id of duplicateIds) {
      await tx.product.update({
        where: { id },
        data: {
          isPublished: false,
          stock: 0,
          supplierSku: null,
          enrichmentStatus: "MERGED",
        },
      });
    }

    await tx.product.update({
      where: { id: canonical.id },
      data: {
        name: nextName,
        supplierSku: primarySku,
        price: nextPrice,
        stock: nextStock,
        variants,
        image: realImageProduct?.image || canonical.image,
        description: describedProduct?.description || canonical.description,
        isPublished: products.some((product) => product.isPublished),
        isNew: products.some((product) => product.isNew),
      },
    });

    for (const product of products) {
      const variantId = simpleProductVariantIds.get(product.id) || null;
      await tx.orderItem.updateMany({
        where: { productId: product.id },
        data: {
          productId: canonical.id,
          ...(variantId ? { variantId } : {}),
        },
      });
    }

    if (duplicateIds.length) {
      await tx.priceImportRow.updateMany({
        where: { productId: { in: duplicateIds } },
        data: { productId: canonical.id },
      });
    }
  });

  const result = await prisma.product.findUnique({
    where: { id: canonical.id },
    select: {
      id: true,
      name: true,
      price: true,
      stock: true,
      variants: true,
      isPublished: true,
    },
  });

  return NextResponse.json({
    product: result,
    mergedProductIds: duplicateIds,
  });
}
