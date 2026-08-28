// app/api/posts/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const PostSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  content: z.string().min(1),
  category: z.string().min(1),
  image: z.string().optional().nullable(),
  imageCredit: z.string().optional().nullable(),
  imageSourceUrl: z.string().url().optional().nullable(),
  imageLicense: z.string().optional().nullable(),
  imageLicenseUrl: z.string().url().optional().nullable(),
});

export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  const post = await prisma.post.findUnique({
    where: { id: params.id },
  });

  if (!post) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(post);
}

export async function PUT(req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const body = PostSchema.parse(await req.json());

    const post = await prisma.post.update({
      where: { id: params.id },
      data: {
        title: body.title.trim(),
        slug: body.slug.trim(),
        content: body.content.trim(),
        category: body.category.trim(),
        image: body.image?.trim() || null,
        imageCredit: body.imageCredit?.trim() || null,
        imageSourceUrl: body.imageSourceUrl?.trim() || null,
        imageLicense: body.imageLicense?.trim() || null,
        imageLicenseUrl: body.imageLicenseUrl?.trim() || null,
      },
    });

    return NextResponse.json(post);
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json({ error: "validation", issues: e.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "failed_to_update" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    await prisma.post.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "failed_to_delete" }, { status: 500 });
  }
}
