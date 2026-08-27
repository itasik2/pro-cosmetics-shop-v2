import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl } from "@/lib/siteConfig";
import { collapseRepresentedProductCards } from "@/lib/publicProductCards";

const INDEXABLE_CATEGORY_SLUGS = ["kremy", "syvorotki", "toniki"] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicBaseUrl();

  const staticRoutes: MetadataRoute.Sitemap = [
    "",
    "/shop",
    "/blog",
    "/about",
    "/contacts",
    "/ask",
  ].map((path) => ({
    url: `${baseUrl}${path || "/"}`,
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));

  const categoryRoutes: MetadataRoute.Sitemap = INDEXABLE_CATEGORY_SLUGS.map(
    (slug) => ({
      url: `${baseUrl}/shop/category/${slug}`,
      changeFrequency: "weekly",
      priority: 0.75,
    }),
  );

  const productRows = await prisma.product.findMany({
    where: {
      isPublished: true,
      enrichmentStatus: { not: "MERGED" },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      updatedAt: true,
      supplierId: true,
      volumeValue: true,
      volumeUnit: true,
      variants: true,
      brand: { select: { name: true } },
    },
  });
  const products = collapseRepresentedProductCards(productRows);

  const productRoutes: MetadataRoute.Sitemap = products.map((product) => ({
    url: `${baseUrl}/shop/${product.slug}`,
    lastModified: product.updatedAt,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const posts = await prisma.post.findMany({
    select: { slug: true, updatedAt: true },
  });

  const postRoutes: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: post.updatedAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      products: {
        some: {
          isPublished: true,
          enrichmentStatus: { not: "MERGED" },
        },
      },
    },
    select: { slug: true, updatedAt: true },
  });

  const brandRoutes: MetadataRoute.Sitemap = brands.map((brand) => ({
    url: `${baseUrl}/brand/${brand.slug}`,
    lastModified: brand.updatedAt,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [
    ...staticRoutes,
    ...categoryRoutes,
    ...productRoutes,
    ...postRoutes,
    ...brandRoutes,
  ];
}
