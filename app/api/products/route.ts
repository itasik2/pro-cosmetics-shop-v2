export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";

const ProductSchema = z.object({
  name: z.string().min(2),
  brandId: z.string().nullable().optional(), // <-- теперь так
  description: z.string().min(1),
  image: z.string().min(1),
  category: z.string().min(1),
  price: z.number().int().min(0),
  stock: z.number().int().min(0),
  isPopular: z.boolean().optional().default(false),
});

export async function GET() {
  const items = await prisma.product.findMany({
    include: { brand: true },
    orderBy: [{ isPopular: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const session = await auth();
  const adminEmail = (process.env.AUTH_ADMIN_EMAIL || "").toLowerCase();
  const email = (session?.user?.email || "").toLowerCase();

  if (!email || email !== adminEmail) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const parsed = ProductSchema.parse(await req.json());

    // защита: если brandId передали, проверим что бренд существует и активен (по желанию)
    if (parsed.brandId) {
      const b = await prisma.brand.findUnique({
        where: { id: parsed.brandId },
        select: { id: true },
      });
      if (!b) {
        return NextResponse.json({ error: "brand_not_found" }, { status: 400 });
      }
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
      },
      include: { brand: true },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json(
        { error: "validation", issues: e.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "failed_to_create" }, { status: 500 });
  }
}
