import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const revalidate = 0;

// Публично: отдать активные бренды для витрины/форм
export async function GET() {
  const items = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true },
  });

  return NextResponse.json(items);
}

// Если хочешь создавать бренды только из админки — позже добавим POST/PUT/DELETE.
export async function POST(req: Request) {
  const session = await auth();
  const adminEmail = (process.env.AUTH_ADMIN_EMAIL || "").toLowerCase();
  const email = (session?.user?.email || "").toLowerCase();

  if (!email || email !== adminEmail) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const name = String(body?.name || "").trim();
  const slug = String(body?.slug || "").trim();

  if (!name || !slug) {
    return NextResponse.json({ error: "name and slug required" }, { status: 400 });
  }

  const created = await prisma.brand.create({
    data: { name, slug, isActive: true, sortOrder: 0 },
  });

  return NextResponse.json(created, { status: 201 });
}
