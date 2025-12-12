// app/api/products/[id]/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";

const ProductSchema = z.object({
  name: z.string().min(2),
  brand: z.string().min(1),
  description: z.string().min(1),
  image: z.string().min(1),
  category: z.string().min(1),
  price: z.number().int().min(0),
  stock: z.number().int().min(0),
  isPopular: z.boolean().optional().default(false),
});

type Params = { params: { id: string } };

export async function PUT(req: Request, { params }: Params) {
  const session = await auth();
  if (
    !session?.user?.email ||
    session.user.email !== process.env.AUTH_ADMIN_EMAIL
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const parsed = ProductSchema.parse(await req.json());

    const updated = await prisma.product.update({
      where: { id: params.id },
      data: {
        name: parsed.name,
        brand: parsed.brand,
        description: parsed.description,
        image: parsed.image,
        category: parsed.category,
        price: parsed.price,
        stock: parsed.stock,
        isPopular: parsed.isPopular ?? false,
      },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json(
        { error: "validation", issues: e.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "failed_to_update" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (
    !session?.user?.email ||
    session.user.email !== process.env.AUTH_ADMIN_EMAIL
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.product.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
