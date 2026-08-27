import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import { collapseRepresentedProductCards } from "@/lib/publicProductCards";
import { serializeJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = {
  params: { slug: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const brand = await prisma.brand.findUnique({
    where: { slug: params.slug },
  });

  if (!brand || !brand.isActive) {
    return {
      title: `Бренд не найден — ${SITE_BRAND}`,
      robots: { index: false, follow: false },
    };
  }

  const baseUrl = getPublicBaseUrl();
  const brandUrl = `${baseUrl}/brand/${brand.slug}`;
  const description = `Профессиональная косметика ${brand.name}: подробные карточки и доставка по Казахстану.`;

  return {
    title: `${brand.name} — купить косметику в Казахстане | ${SITE_BRAND}`,
    description,
    keywords: [
      `косметика ${brand.name}`,
      `${brand.name} купить`,
      `${brand.name} Казахстан`,
    ],
    alternates: {
      canonical: brandUrl,
    },
    openGraph: {
      title: brand.name,
      description,
      url: brandUrl,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${brand.name} — ${SITE_BRAND}`,
      description,
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
  const brandUrl = `${baseUrl}/brand/${brand.slug}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Brand",
        "@id": `${brandUrl}#brand`,
        name: brand.name,
        url: brandUrl,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${brandUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Главная",
            item: baseUrl,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Бренды",
            item: `${baseUrl}/shop`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: brand.name,
            item: brandUrl,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />

      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{brand.name}</h1>

        {products.length === 0 ? (
          <div className="text-gray-500">Товары отсутствуют</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
