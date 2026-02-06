import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireAdmin, isAdminRequest } from "@/lib/adminGuard";

export const runtime = "nodejs";

const ReviewCreateSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5).optional().default(5),
  isPublic: z.boolean().optional().default(true),
});

// Публично можно читать только опубликованные отзывы (для главной)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";

  if (all) {
    if (!(await isAdminRequest())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const body = ReviewCreateSchema.parse(await req.json().catch(() => ({})));

    const created = await prisma.review.create({
      data: {
        name: body.name.trim(),
        text: body.text.trim(),
        rating: body.rating,
        isPublic: body.isPublic,
      },
    });

    return NextResponse.json(created);
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json({ error: "validation", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed_to_create" }, { status: 500 });
  }
}
