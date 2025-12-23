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

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));

  const data: any = {};
  if (body?.name !== undefined) data.name = String(body.name).trim();
  if (body?.text !== undefined) data.text = String(body.text).trim();
  if (body?.rating !== undefined)
    data.rating = Math.min(5, Math.max(1, Math.trunc(Number(body.rating) || 5)));
  if (body?.isPublic !== undefined) data.isPublic = !!body.isPublic;

  const updated = await prisma.review.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.review.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
