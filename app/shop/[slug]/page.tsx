import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ProductDetailsClient from "@/components/ProductDetailsClient";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import { formatProductName } from "@/lib/productNames";
import { seoDescription, serializeJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = {
  params: { slug: string };
};

async function getPublicProduct(slug: string) {
  return prisma.product.findFirst({
    where: {
      slug,
      isPublished: true,
      enrichmentStatus: { not: "MERGED" },
    },
    include: { brand: true },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getPublicProduct(params.slug);

  if (!product) {
    return {
      title: `Товар не найден — ${SITE_BRAND}`,
      robots: { index: false, follow: false },
    };
  }

  const baseUrl = getPublicBaseUrl();
  const productUrl = `${baseUrl}/shop/${product.slug}`;
  const displayName = formatProductName(product.name);
  const metaDescription =
    seoDescription(product.shortDescription, 160) ||
    seoDescription(product.description, 160);

  return {
    title: `${displayName} — ${SITE_BRAND}`,
    description: metaDescription,
    keywords: [
      `купить ${displayName}`,
      product.brand?.name ? `${product.brand.name} купить` : "",
      product.brand?.name ? `косметика ${product.brand.name}` : "",
      `${product.category} купить`,
    ].filter(Boolean),
    alternates: {
      canonical: productUrl,
    },
    openGraph: {
      title: displayName,
      description: metaDescription,
      images: product.image ? [product.image] : [],
      url: productUrl,
      type: "website",
    },
    twitter: {
      card: product.image ? "summary_large_image" : "summary",
      title: displayName,
      description: metaDescription,
      images: product.image ? [product.image] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await getPublicProduct(params.slug);
  if (!product) notFound();

  const baseUrl = getPublicBaseUrl();
  const productUrl = `${baseUrl}/shop/${product.slug}`;
  const displayName = formatProductName(product.name);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "@id": `${productUrl}#product`,
        name: displayName,
        image: product.image ? [product.image] : [],
        description: seoDescription(product.shortDescription || product.description, 500),
        sku: product.supplierSku || undefined,
        url: productUrl,
        brand: product.brand?.name
          ? {
              "@type": "Brand",
              name: product.brand.name,
            }
          : undefined,
        offers: {
          "@type": "Offer",
          priceCurrency: "KZT",
          price: product.price,
          availability:
            product.stock > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
          url: productUrl,
          seller: { "@id": `${baseUrl}/#organization` },
        },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${productUrl}#breadcrumb`,
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
            name: "Каталог",
            item: `${baseUrl}/shop`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: displayName,
            item: productUrl,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(structuredData),
        }}
      />

      <div className="py-10">
        <ProductDetailsClient product={product} />
      </div>
    </>
  );
}
