import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { z } from "zod";

export const runtime = "nodejs";
export const revalidate = 0;

async function isAdmin() {
  const session = await auth();
  const adminEmail = (process.env.AUTH_ADMIN_EMAIL || "").toLowerCase();
  const email = (session?.user?.email || "").toLowerCase();
  return !!email && email === adminEmail;
}

// GET /api/brands
// - публично: активные бренды для витрины/форм
// - админ: ?all=1 — все бренды
export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";

  if (all) {
    if (!(await isAdmin())) {
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
  name: z.string().min(1),
  slug: z.string().min(1),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const parsed = BrandSchema.parse(await req.json());

    const created = await prisma.brand.create({
      data: {
        name: parsed.name.trim(),
        slug: parsed.slug.trim(),
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

    // уникальные индексы name/slug могут дать Prisma error
    return NextResponse.json({ error: "failed_to_create" }, { status: 500 });
  }
}
