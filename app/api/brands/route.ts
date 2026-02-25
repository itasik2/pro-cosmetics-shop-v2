import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireAdmin, isAdminRequest } from "@/lib/adminGuard";

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

// GET /api/brands
// - публично: активные бренды для витрины/форм
// - админ: ?all=1 — все бренды
export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";

  if (all) {
    if (!(await isAdminRequest())) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const items = await prisma.brand.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(items);
  }

  const items = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true },
  });
  return NextResponse.json(items);
}

const BrandSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const parsed = BrandSchema.parse(await req.json());
    const normalizedSlug = normalizeSlug(parsed.slug);

    if (!slugRegex.test(normalizedSlug)) {
      return NextResponse.json({ error: "validation", issues: [{ path: ["slug"], message: "invalid_slug" }] }, { status: 400 });
    }

    const created = await prisma.brand.create({
      data: {
        name: parsed.name,
        slug: normalizedSlug,
        sortOrder: parsed.sortOrder ?? 0,
        isActive: parsed.isActive ?? true,
      },
    });

    return NextResponse.json(created, { status: 201 });
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

    // уникальные индексы name/slug могут дать Prisma error
    return NextResponse.json({ error: "failed_to_create" }, { status: 500 });
  }
}
