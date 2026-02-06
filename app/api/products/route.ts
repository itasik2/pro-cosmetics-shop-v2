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

export async function GET() {
  // ВАЖНО: для админ-редактирования нужны ВСЕ поля формы
  const rows = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      brandId: true,        // <-- ДОБАВЛЕНО
      description: true,    // <-- ДОБАВЛЕНО
      image: true,
      category: true,
      price: true,
      stock: true,
      isPopular: true,
      isNew: true,          // <-- ДОБАВЛЕНО
      createdAt: true,
      variants: true,
      brand: { select: { id: true, name: true } }, // <-- расширил (id полезен)
    },
  });

  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const parsed = ProductSchema.parse(await req.json());

    if (parsed.brandId) {
      const b = await prisma.brand.findUnique({
        where: { id: parsed.brandId },
        select: { id: true },
      });
      if (!b) return NextResponse.json({ error: "brand_not_found" }, { status: 400 });
    }

    const created = await prisma.product.create({
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

    return NextResponse.json(created);
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json({ error: "validation", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed_to_create" }, { status: 500 });
  }
}
