import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import ProductCard from "@/components/ProductCard";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import { buildBrandIntentKeywords } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type Props = {
  params: { slug: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {

  const brand = await prisma.brand.findUnique({
    where: { slug: params.slug },
  });

  if (!brand) {
    return {
      title: `Бренд не найден – ${SITE_BRAND}`,
    };
  }

  const baseUrl = getPublicBaseUrl();

  return {
    title: `${brand.name} купить – ${SITE_BRAND}`,
    description:
      `Каталог косметики ${brand.name}. Профессиональная косметика ${brand.name} с доставкой по Казахстану.`,
    keywords: [
      ...buildBrandIntentKeywords([brand], ["крем", "сыворотка", "уход"]),
      `${brand.name} Казахстан`,
    ],
    alternates: {
      canonical: `${baseUrl}/brand/${brand.slug}`,
    },
  };
}

export default async function BrandPage({ params }: Props) {

  const brand = await prisma.brand.findUnique({
    where: { slug: params.slug },
  });

  if (!brand) notFound();

  const products = await prisma.product.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      name: true,
      image: true,
      price: true,
      stock: true,
      isPopular: true,
      createdAt: true,
      category: true,
      variants: true,
      brand: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-6">

      <h1 className="text-3xl font-bold">
        {brand.name}
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>

    </div>
  );
}
