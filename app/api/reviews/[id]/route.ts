import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";

const ReviewUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    isPublic: z.boolean().optional(),
  })
  .strict();

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const body = ReviewUpdateSchema.parse(await req.json().catch(() => ({})));

    const data: any = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.text !== undefined) data.text = body.text.trim();
    if (body.rating !== undefined) data.rating = body.rating;
    if (body.isPublic !== undefined) data.isPublic = body.isPublic;

    const updated = await prisma.review.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json({ error: "validation", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed_to_update" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  await prisma.review.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
