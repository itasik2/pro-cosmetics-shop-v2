export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";

const ProductUpdate = z.object({
  name: z.string().min(2),
  brand: z.string().min(1),
  description: z.string().min(1),
  image: z.string().min(1),
  category: z.string().min(1),
  price: z.number().int().positive(), // minor
  stock: z.number().int().min(0),
});

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const item = await prisma.product.findUnique({ where: { id: params.id } });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(item);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email || session.user.email !== process.env.AUTH_ADMIN_EMAIL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const data = ProductUpdate.parse(await req.json());
    const updated = await prisma.product.update({ where: { id: params.id }, data });
    return NextResponse.json(updated);
  } catch (e: any) {
    if (e?.name === "ZodError") return NextResponse.json({ error: "validation", issues: e.issues }, { status: 400 });
    return NextResponse.json({ error: "failed_to_update" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.email || session.user.email !== process.env.AUTH_ADMIN_EMAIL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    await prisma.product.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "failed_to_delete" }, { status: 500 });
  }
}
