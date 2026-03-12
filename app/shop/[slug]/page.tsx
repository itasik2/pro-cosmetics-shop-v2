import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ProductDetailsClient from "@/components/ProductDetailsClient";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";

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
    description: `${product.brand?.name ?? ""} ${product.category}. Цена ${product.price} ₸.`,
    keywords: [
      `купить ${product.name}`,
      product.brand?.name ? `купить крем ${product.brand.name}` : "",
      product.brand?.name ? `косметика ${product.brand.name}` : "",
      `${product.category} купить`,
    ].filter(Boolean),
    alternates: {
      canonical: `${baseUrl}/shop/${product.slug}`,
    },
    openGraph: {
      title: product.name,
      description: product.description.slice(0, 150),
      images: product.image ? [product.image] : [],
      url: `${baseUrl}/shop/${product.slug}`,
      type: "website",
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await prisma.product.findUnique({
    where: { slug: params.slug },
    include: { brand: true },
  });

  if (!product) notFound();

  const baseUrl = getPublicBaseUrl();

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.image ? [`${product.image}`] : [],
    description: product.description,
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
      url: `${baseUrl}/shop/${product.slug}`,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema),
        }}
      />

      <div className="py-10">
        <ProductDetailsClient product={product} />
      </div>
    </>
  );
}
