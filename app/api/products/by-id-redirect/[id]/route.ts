import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

type Props = {
  params: { id: string };
};

export async function GET(_req: Request, { params }: Props) {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    select: { slug: true },
  });

  if (!product?.slug) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.redirect(new URL(`/shop/${product.slug}`, _req.url), 308);
}
