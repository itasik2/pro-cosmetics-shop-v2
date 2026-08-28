import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ProductDetailsClient from "@/components/ProductDetailsClient";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import { formatProductName } from "@/lib/productNames";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
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

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const product = await getPublicProduct(params.slug);

  if (!product) {
    return {
      title: `Товар не найден — ${SITE_BRAND}`,
      robots: { index: false, follow: false },
    };
  }

  const baseUrl = getPublicBaseUrl();
  const displayName = formatProductName(product.name);
  const metaDescription =
    product.shortDescription?.trim() ||
    product.description.replace(/\s+/g, " ").trim().slice(0, 280);

  return {
    title: `${displayName} — ${SITE_BRAND}`,
    description: metaDescription,
    keywords: [
      `купить ${displayName}`,
      product.brand?.name ? `купить крем ${product.brand.name}` : "",
      product.brand?.name ? `косметика ${product.brand.name}` : "",
      `${product.category} купить`,
    ].filter(Boolean),
    alternates: {
      canonical: `${baseUrl}/shop/${product.slug}`,
    },
    openGraph: {
      title: displayName,
      description: metaDescription,
      images: product.image ? [product.image] : [],
      url: `${baseUrl}/shop/${product.slug}`,
      type: "website",
    },
  };
}

export default async function ProductPage(props: Props) {
  const params = await props.params;
  const product = await getPublicProduct(params.slug);
  if (!product) notFound();

  const baseUrl = getPublicBaseUrl();
  const displayName = formatProductName(product.name);
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: displayName,
    image: product.image ? [product.image] : [],
    description: product.shortDescription || product.description,
    sku: product.supplierSku || undefined,
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
