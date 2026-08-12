// app/sitemap.ts
import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl } from "@/lib/siteConfig";
import { collapseRepresentedProductCards } from "@/lib/publicProductCards";

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
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));

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

  return [...staticRoutes, ...productRoutes, ...postRoutes, ...brandRoutes];
}
