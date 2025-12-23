import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await auth();
  const adminEmail = (process.env.AUTH_ADMIN_EMAIL || "").toLowerCase();
  const email = (session?.user?.email || "").toLowerCase();
  if (!email || email !== adminEmail) return null;
  return session;
}

// Публично можно читать только опубликованные отзывы (для главной)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";

  if (all) {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const items = await prisma.review.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(items);
  }

  const items = await prisma.review.findMany({
    where: { isPublic: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));

  const name = String(body?.name || "").trim();
  const text = String(body?.text || "").trim();
  const rating = Math.min(5, Math.max(1, Math.trunc(Number(body?.rating) || 5)));
  const isPublic = body?.isPublic !== false;

  if (!name || !text) {
    return NextResponse.json({ error: "name and text are required" }, { status: 400 });
  }

  const created = await prisma.review.create({
    data: { name, text, rating, isPublic },
  });

  return NextResponse.json(created);
}
