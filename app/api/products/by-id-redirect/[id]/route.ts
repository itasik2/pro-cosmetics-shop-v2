import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

type Props = {
  params: { id: string };
};

export async function GET(req: Request, { params }: Props) {
  const product = await prisma.product.findFirst({
    where: { id: params.id, isPublished: true },
    select: { slug: true },
  });

  if (!product?.slug) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.redirect(new URL(`/shop/${product.slug}`, req.url), 308);
}
