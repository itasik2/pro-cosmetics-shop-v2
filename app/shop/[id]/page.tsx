import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import ProductDetailsClient from "./ProductDetailsClient";
import { SITE_BRAND } from "@/lib/siteConfig";


type Props = { params: { id: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { brand: true },
  });

  if (!product) {
    return {
      title: `Товар не найден – ${SITE_BRAND}`,
    };
  }

  return {
    title: `${product.name} – ${SITE_BRAND}`,
    description: `${product.brand?.name ?? ""} ${product.category}. Цена ${product.price} ₸`,
    openGraph: {
      title: product.name,
      images: [product.image],
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { brand: true },
  });

  if (!product) {
    return <div className="py-10">Товар не найден</div>;
  }

  return (
    <div className="py-10">
      <ProductDetailsClient product={product} />
    </div>
  );
}
