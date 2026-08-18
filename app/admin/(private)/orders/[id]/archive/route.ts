// app/admin/(private)/orders/[id]/archive/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ActionSchema = z.enum(["archive", "restore"]);

function safeReturnUrl(req: Request, value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.startsWith("/admin/orders")) return new URL(raw, req.url);
  return new URL("/admin/orders", req.url);
}

function redirectWithError(req: Request, error: string) {
  const url = new URL("/admin/orders", req.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const isAdmin = (session?.user as any)?.role === "admin";
  if (!isAdmin) return NextResponse.redirect(new URL("/admin", req.url), 303);

  const form = await req.formData();
  const parsedAction = ActionSchema.safeParse(String(form.get("action") || "").trim());
  if (!parsedAction.success) return redirectWithError(req, "invalid_archive_action");

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!order) return redirectWithError(req, "order_not_found");

  await prisma.order.update({
    where: { id: order.id },
    data: {
      archivedAt: parsedAction.data === "archive" ? new Date() : null,
    },
  });

  return NextResponse.redirect(safeReturnUrl(req, form.get("returnTo")), 303);
}
