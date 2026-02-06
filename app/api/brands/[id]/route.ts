import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";
export const revalidate = 0;

const BrandUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

type Params = { params: { id: string } };

export async function PUT(req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const parsed = BrandUpdateSchema.parse(await req.json());

    const data: any = {};
    if (parsed.name !== undefined) data.name = parsed.name.trim();
    if (parsed.slug !== undefined) data.slug = parsed.slug.trim();
    if (parsed.sortOrder !== undefined) data.sortOrder = parsed.sortOrder;
    if (parsed.isActive !== undefined) data.isActive = parsed.isActive;

    const updated = await prisma.brand.update({
      where: { id: params.id },
      data,
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

  // Безопасно: отвязываем товары от бренда, затем удаляем бренд
  await prisma.product.updateMany({
    where: { brandId: params.id },
    data: { brandId: null },
  });

  await prisma.brand.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}
