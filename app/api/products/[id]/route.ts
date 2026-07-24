export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";

const ProductSchema = z.object({
  name: z.string().min(2),
  brandId: z.string().nullable().optional(),
  description: z.string().min(1),
  image: z.string().min(1),
  category: z.string().min(1),
  price: z.number().int().min(0),
  stock: z.number().int().min(0),
  isPopular: z.boolean().optional().default(false),
  isNew: z.boolean().optional().default(false),
  isPublished: z.boolean().optional().default(true),
  variants: z.any().nullable().optional(),
});

const PublishSchema = z.object({
  isPublished: z.boolean(),
});

type Params = { params: { id: string } };

export async function PUT(req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const parsed = ProductSchema.parse(await req.json());

    if (parsed.brandId) {
      const brand = await prisma.brand.findUnique({
        where: { id: parsed.brandId },
        select: { id: true },
      });
      if (!brand) {
        return NextResponse.json(
          { error: "brand_not_found" },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.product.update({
      where: { id: params.id },
      data: {
        name: parsed.name,
        brandId: parsed.brandId ?? null,
        description: parsed.description,
        image: parsed.image,
        category: parsed.category,
        price: parsed.price,
        stock: parsed.stock,
        isPopular: parsed.isPopular,
        isNew: parsed.isNew,
        isPublished: parsed.isPublished,
        enrichmentStatus: parsed.isPublished ? "READY" : "PENDING",
        variants: parsed.variants ?? null,
      },
      include: { brand: true, supplier: true },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: "validation", issues: error.issues },
        { status: 400 },
      );
    }

    console.error(`PUT /api/products/${params.id}`, error);
    return NextResponse.json(
      { error: "failed_to_update" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = PublishSchema.safeParse(await req.json().catch(() => null));
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
      description: true,
      image: true,
      category: true,
      price: true,
      brandId: true,
      isPublished: true,
    },
  });
  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  if (parsed.data.isPublished) {
    const missing: string[] = [];
    const description = product.description.trim().toLocaleLowerCase("ru-RU");
    if (!product.brandId) missing.push("бренд");
    if (!description || description === "описание готовится") missing.push("описание");
    if (!product.image || product.image === "/seed/cleanser.jpg") missing.push("фотография");
    if (!product.category.trim()) missing.push("категория");
    if (product.price <= 0) missing.push("цена");

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
      isPublished: parsed.data.isPublished,
      enrichmentStatus: parsed.data.isPublished ? "READY" : "PENDING",
    },
    include: { brand: true, supplier: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  await prisma.product.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
