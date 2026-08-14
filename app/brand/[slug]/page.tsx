import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import { collapseRepresentedProductCards } from "@/lib/publicProductCards";

export const dynamic = "force-dynamic";

type Props = {
  params: { slug: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const brand = await prisma.brand.findUnique({
    where: { slug: params.slug },
  });

  if (!brand || !brand.isActive) {
    return { title: `Бренд не найден – ${SITE_BRAND}` };
  }

  const baseUrl = getPublicBaseUrl();

  return {
    title: `${brand.name} – купить косметику в Казахстане | ${SITE_BRAND}`,
    description: `Профессиональная косметика ${brand.name}: подробные карточки и доставка по Казахстану.`,
    keywords: [
      `косметика ${brand.name}`,
      `${brand.name} купить`,
      `${brand.name} Казахстан`,
    ],
    alternates: {
      canonical: `${baseUrl}/brand/${brand.slug}`,
    },
    openGraph: {
      title: brand.name,
      description: `Косметика ${brand.name}`,
      url: `${baseUrl}/brand/${brand.slug}`,
      type: "website",
    },
  };
}

export default async function BrandPage({ params }: Props) {
  const brand = await prisma.brand.findUnique({
    where: { slug: params.slug },
  });

  if (!brand || !brand.isActive) notFound();

  const productRows = await prisma.product.findMany({
    where: {
      brandId: brand.id,
      isPublished: true,
      enrichmentStatus: { not: "MERGED" },
    },
    include: { brand: true },
    orderBy: { createdAt: "desc" },
  });
  const products = collapseRepresentedProductCards(productRows);

  const baseUrl = getPublicBaseUrl();
  const schema = {
    "@context": "https://schema.org",
    "@type": "Brand",
    name: brand.name,
    url: `${baseUrl}/brand/${brand.slug}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{brand.name}</h1>

        {products.length === 0 ? (
          <div className="text-gray-500">Товары отсутствуют</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
