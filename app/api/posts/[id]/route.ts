// app/api/posts/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  const post = await prisma.post.findUnique({
    where: { id: params.id },
  });

  if (!post) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json(post);
}

export async function PUT(req: Request, { params }: Params) {
  const body = await req.json();
  const { title, slug, content, category, image } = body;

  if (!title || !slug || !content || !category) {
    return NextResponse.json(
      { error: "missing_fields" },
      { status: 400 },
    );
  }

  const post = await prisma.post.update({
    where: { id: params.id },
    data: {
      title,
      slug,
      content,
      category,
      image,
    },
  });

  return NextResponse.json(post);
}

export async function DELETE(_req: Request, { params }: Params) {
  await prisma.post.delete({
    where: { id: params.id },
  });

  return NextResponse.json({ ok: true });
}
