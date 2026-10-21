export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { invalidateChangedSkuImages } from "@/lib/enrichment/variantImages";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import { prisma } from "@/lib/prisma";
import { recoverStaleEnrichmentJobs } from "@/lib/enrichment/recoverStaleJobs";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { formatProductName } from "@/lib/productNames";
import { variantStockTotal } from "@/lib/productStock";
import { processStockAlertsForProduct } from "@/lib/stockAlerts";
import {
  publicationMissingFields,
  publishEditedProduct,
} from "@/lib/productPublication";

const ProductSchema = z.object({
  name: z.string().min(2),
  brandId: z.string().nullable().optional(),
  shortDescription: z.string().max(280).nullable().optional(),
  description: z.string().min(1),
  image: z.string().min(1),
  category: z.string().min(1),
  price: z.number().int().min(0),
  stock: z.number().int().min(0),
  isPopular: z.boolean().optional().default(false),
  isNew: z.boolean().optional().default(false),
  isPublished: z.boolean().optional().default(true),
  publishNow: z.boolean().optional().default(false),
  variants: z.any().nullable().optional(),
});

const ProductPatchSchema = z
  .object({
    isPublished: z.boolean().optional(),
    stock: z.number().int().min(0).optional(),
  })
  .refine(
    (value) => value.isPublished !== undefined || value.stock !== undefined,
    { message: "Укажите статус публикации или количество." },
  );

type Params = { params: Promise<{ id: string }> };

async function hasAppliedEnrichment(productId: string) {
  const proposal = await prisma.productEnrichmentProposal.findFirst({
    where: {
      productId,
      status: "APPLIED",
    },
    select: { id: true },
  });

  return Boolean(proposal);
}

export async function PUT(req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const parsed = ProductSchema.parse(await req.json());
    if (parsed.publishNow) parsed.isPublished = true;
    await recoverStaleEnrichmentJobs(prisma, [params.id]);
    const current = await prisma.product.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        updatedAt: true,
        isPublished: true,
        supplierId: true,
        lastImportedAt: true,
        variants: true,
        isPopular: true,
        popularityPinned: true,
        popularityExcluded: true,
      },
    });

    if (!current) {
      return NextResponse.json({ error: "product_not_found" }, { status: 404 });
    }

    if (parsed.brandId) {
      const brand = await prisma.brand.findUnique({
        where: { id: parsed.brandId },
        select: { id: true },
      });
      if (!brand) {
        return NextResponse.json({ error: "brand_not_found" }, { status: 400 });
      }
    }

    if (parsed.publishNow || (parsed.isPublished && !current.isPublished)) {
      const imported = Boolean(current.supplierId || current.lastImportedAt);
      const approved =
        imported && !parsed.publishNow
          ? await hasAppliedEnrichment(current.id)
          : !imported;
      const missing = publicationMissingFields(
        {
          brandId: parsed.brandId ?? null,
          shortDescription: parsed.shortDescription?.trim() || null,
          description: parsed.description,
          image: parsed.image,
          category: parsed.category,
          price: parsed.price,
        },
        {
          imported,
          hasAppliedEnrichment: approved,
          reviewedInEditor: parsed.publishNow,
        },
      );

      if (missing.length) {
        return NextResponse.json(
          {
            error: "product_not_ready_for_publication",
            message: `Перед публикацией заполните: ${missing.join(", ")}.`,
            missing,
          },
          { status: 409 },
        );
      }
    }

    if (Array.isArray(parsed.variants))
      parsed.variants = invalidateChangedSkuImages(
        normalizeStoredVariants(current.variants),
        normalizeStoredVariants(parsed.variants),
      );
    const popularityChanged = parsed.isPopular !== current.isPopular;
    const stock = variantStockTotal(parsed.variants) ?? parsed.stock;
    const data = {
      name: formatProductName(parsed.name),
      brandId: parsed.brandId ?? null,
      shortDescription: parsed.shortDescription?.trim() || null,
      description: parsed.description,
      image: parsed.image,
      category: parsed.category,
      price: parsed.price,
      stock,
      isPopular: parsed.isPopular,
      ...(popularityChanged
        ? {
            popularityPinned: parsed.isPopular,
            popularityExcluded: !parsed.isPopular,
          }
        : {}),
      isNew: parsed.isNew,
      isPublished: parsed.isPublished,
      enrichmentStatus: parsed.isPublished ? "READY" : "PENDING",
      variants: parsed.variants ?? null,
    };
    const updated = parsed.publishNow
      ? await publishEditedProduct({
          productId: current.id,
          expectedUpdatedAt: current.updatedAt,
          data,
        })
      : await prisma.product.update({
          where: { id: params.id },
          data,
          include: { brand: true, supplier: true },
        });

    await processStockAlertsForProduct(updated.id);
    return NextResponse.json(updated);
  } catch (error: any) {
    if (
      ["publication_enrichment_running", "product_changed_refresh"].includes(
        error?.message,
      )
    ) {
      return NextResponse.json(
        {
          error: error.message,
          message:
            error.message === "publication_enrichment_running"
              ? "Поиск ИИ ещё выполняется. Дождитесь завершения и повторите публикацию."
              : "Товар изменился во время сохранения. Откройте карточку повторно и проверьте данные.",
        },
        { status: 409 },
      );
    }
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: "validation", issues: error.issues },
        { status: 400 },
      );
    }

    console.error(`PUT /api/products/${params.id}`, error);
    return NextResponse.json({ error: "failed_to_update" }, { status: 500 });
  }
}

export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = ProductPatchSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      shortDescription: true,
      description: true,
      image: true,
      category: true,
      price: true,
      stock: true,
      brandId: true,
      supplierId: true,
      lastImportedAt: true,
      isPublished: true,
    },
  });
  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  if (parsed.data.isPublished === true) {
    const imported = Boolean(product.supplierId || product.lastImportedAt);
    const approved = imported ? await hasAppliedEnrichment(product.id) : true;
    const missing = publicationMissingFields(product, {
      imported,
      hasAppliedEnrichment: approved,
    });

    if (missing.length) {
      return NextResponse.json(
        {
          error: "product_not_ready_for_publication",
          message: `Перед публикацией заполните: ${missing.join(", ")}.`,
          missing,
        },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      ...(parsed.data.isPublished !== undefined
        ? {
            isPublished: parsed.data.isPublished,
            enrichmentStatus: parsed.data.isPublished ? "READY" : "PENDING",
          }
        : {}),
      ...(parsed.data.stock !== undefined ? { stock: parsed.data.stock } : {}),
    },
    include: { brand: true, supplier: true },
  });

  if (parsed.data.stock !== undefined) {
    await processStockAlertsForProduct(updated.id);
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  await prisma.product.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
