// app/api/posts/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(posts);
}

export async function POST(req: Request) {
  const body = await req.json();

  const { title, slug, content, category, image } = body;

  if (!title || !slug || !content || !category) {
    return NextResponse.json(
      { error: "missing_fields" },
      { status: 400 },
    );
  }

  const post = await prisma.post.create({
    data: {
      title,
      slug,
      content,
      category,
      image,
    },
  });

  return NextResponse.json(post, { status: 201 });
}

