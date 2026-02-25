import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";
export const revalidate = 0;

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const BrandUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    slug: z.string().trim().min(1).max(120).optional(),
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
    if (parsed.name !== undefined) data.name = parsed.name;
    if (parsed.slug !== undefined) {
      const normalizedSlug = normalizeSlug(parsed.slug);
      if (!slugRegex.test(normalizedSlug)) {
        return NextResponse.json({ error: "validation", issues: [{ path: ["slug"], message: "invalid_slug" }] }, { status: 400 });
      }
      data.slug = normalizedSlug;
    }
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

    if (e?.code === "P2002") {
      return NextResponse.json({ error: "brand_already_exists" }, { status: 409 });
    }

    if (e?.code === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ error: "failed_to_update" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    // Безопасно: отвязываем товары от бренда, затем удаляем бренд
    await prisma.product.updateMany({
      where: { brandId: params.id },
      data: { brandId: null },
    });

    await prisma.brand.delete({ where: { id: params.id } });
  } catch (e: any) {
    if (e?.code === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "failed_to_delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
