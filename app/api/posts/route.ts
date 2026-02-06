// app/api/posts/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { z } from "zod";

const PostSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  content: z.string().min(1),
  category: z.string().min(1),
  image: z.string().optional().nullable(),
});

export async function GET() {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(posts);
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const body = PostSchema.parse(await req.json());

    const post = await prisma.post.create({
      data: {
        title: body.title.trim(),
        slug: body.slug.trim(),
        content: body.content.trim(),
        category: body.category.trim(),
        image: body.image?.trim() || null,
      },
    });

    return NextResponse.json(post, { status: 201 });
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json({ error: "validation", issues: e.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "failed_to_create" }, { status: 500 });
  }
}
