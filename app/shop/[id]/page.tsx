import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: { id: string };
};

export default async function ProductRedirect({ params }: Props) {

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    select: { slug: true },
  });

  if (!product) notFound();

  redirect(`/shop/${product.slug}`);
}
