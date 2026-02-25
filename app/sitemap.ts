// app/sitemap.ts
import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl } from "@/lib/siteConfig";

function getBaseUrl() {
  return getPublicBaseUrl();
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl();

  // Статические страницы
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


  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    select: { slug: true, updatedAt: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const brandRoutes: MetadataRoute.Sitemap = brands.map((b) => ({
    url: `${baseUrl}/shop?brand=${b.slug}`,
    lastModified: b.updatedAt || new Date(),
    changeFrequency: "weekly",
    priority: 0.75,
  }));

  // Динамические товары
  const products = await prisma.product.findMany({
    select: { id: true, updatedAt: true },
  });

  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${baseUrl}/shop/${p.id}`,
    lastModified: p.updatedAt || new Date(),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  // Динамические посты блога
  const posts = await prisma.post.findMany({
    select: { slug: true, updatedAt: true },
  });

  const postRoutes: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${baseUrl}/blog/${p.slug}`,
    lastModified: p.updatedAt || new Date(),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  // Можно позже добавить другие динамические сущности (категории и т.п.)

  return [...staticRoutes, ...brandRoutes, ...productRoutes, ...postRoutes];
}
