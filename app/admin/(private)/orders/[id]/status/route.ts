// app/api/admin/orders/[id]/status/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

const Schema = z.object({
  status: z.enum(["NEW", "CONFIRMED", "PACKING", "SHIPPED", "DONE", "CANCELED"]),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const isAdmin = (session?.user as any)?.role === "admin";
  if (!isAdmin) return NextResponse.redirect(new URL("/admin", req.url));

  const form = await req.formData();
  const status = String(form.get("status") || "");

  const parsed = Schema.safeParse({ status });
  if (!parsed.success) {
    return NextResponse.redirect(new URL(`/admin/orders/${params.id}`, req.url));
  }

  await prisma.order.update({
    where: { id: params.id },
    data: { status: parsed.data.status },
  });

  return NextResponse.redirect(new URL(`/admin/orders/${params.id}`, req.url));
}
