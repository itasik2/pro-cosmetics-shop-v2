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
  price: z.number().int().positive(), // minor units (тиыны)
  stock: z.number().int().min(0).default(0),
});

export async function GET() {
  const items = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email || session.user.email !== process.env.AUTH_ADMIN_EMAIL) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const data = ProductSchema.parse(await req.json());
    const created = await prisma.product.create({ data });
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e?.name === "ZodError") return NextResponse.json({ error: "validation", issues: e.issues }, { status: 400 });
    return NextResponse.json({ error: "failed_to_create" }, { status: 500 });
  }
}
