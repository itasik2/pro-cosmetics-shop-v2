import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import ProductDetailsClient from "../[id]/ProductDetailsClient";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type Props = {
  params: { slug: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {

  const product = await prisma.product.findUnique({
    where: { slug: params.slug },
    include: { brand: true },
  });

  if (!product) {
    return {
      title: `Товар не найден – ${SITE_BRAND}`,
    };
  }

  const baseUrl = getPublicBaseUrl();

  return {
    title: `${product.name} купить – ${SITE_BRAND}`,
    description:
      `${product.brand?.name ?? ""} ${product.category}. Цена ${product.price} ₸. Доставка по Казахстану.`,

    alternates: {
      canonical: `${baseUrl}/shop/${product.slug}`,
    },

    openGraph: {
      title: product.name,
      description: product.description.slice(0, 150),
      images: [product.image],
      url: `${baseUrl}/shop/${product.slug}`,
      type: "product",
    },
  };
}

export default async function ProductPage({ params }: Props) {

  const product = await prisma.product.findUnique({
    where: { slug: params.slug },
    include: { brand: true },
  });

  if (!product) notFound();

  return (
    <div className="py-10">
      <ProductDetailsClient product={product} />
    </div>
  );
}
