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
  isNew: z.boolean().optional().default(false), // <-- ДОБАВЛЕНО

  variants: z.any().nullable().optional(),
});

type Params = { params: { id: string } };

export async function PUT(req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const parsed = ProductSchema.parse(await req.json());

    if (parsed.brandId) {
      const b = await prisma.brand.findUnique({
        where: { id: parsed.brandId },
        select: { id: true },
      });
      if (!b) {
        return NextResponse.json({ error: "brand_not_found" }, { status: 400 });
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
        isPopular: parsed.isPopular ?? false,
        isNew: parsed.isNew ?? false, // <-- ДОБАВЛЕНО
        variants: parsed.variants ?? null,
      },
      include: { brand: true },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json(
        { error: "validation", issues: e.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "failed_to_update" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  await prisma.product.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
