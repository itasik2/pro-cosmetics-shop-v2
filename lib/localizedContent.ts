import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { SiteLocale } from "@/lib/i18n";
import { localizeProductSectionHeadings } from "./productSectionHeadings";

export type LocalizableProduct = {
  id: string;
  name: string;
  shortDescription?: string | null;
  description?: string;
};
export type LocalizablePost = {
  id: string;
  title: string;
  content: string;
  category?: string;
};

export function contentSourceHash(name: string, summary: string | null | undefined, body: string) {
  return createHash("sha256")
    .update(JSON.stringify([name, summary || "", body]))
    .digest("hex");
}

/** Return only published translations matching the original source text. */
export async function localizedProducts<T extends LocalizableProduct>(
  products: T[],
  locale: SiteLocale,
): Promise<T[]> {
  if (locale === "ru" || !products.length) return products;
  const content = await prisma.localizedContent.findMany({
    where: {
      key: { in: products.map((product) => `product:${product.id}`) },
      locale,
      status: "PUBLISHED",
    },
    select: { key: true, name: true, summary: true, body: true, sourceName: true, sourceSummary: true, sourceHash: true },
  });
  const indexed = new Map(content.map((entry) => [entry.key, entry]));
  return products.map((product) => {
    const entry = indexed.get(`product:${product.id}`);
    if (!entry || entry.sourceName !== product.name ||
      (entry.sourceSummary || "") !== (product.shortDescription || "")) return product;
    if ("description" in product && typeof product.description === "string" &&
      entry.sourceHash !== contentSourceHash(product.name, product.shortDescription, product.description)) return product;
    return {
      ...product,
      name: entry.name,
      shortDescription: entry.summary,
      ...("description" in product ? {
        description: localizeProductSectionHeadings(entry.body, locale),
      } : {}),
    };
  });
}

export async function localizedPosts<T extends LocalizablePost>(posts: T[], locale: SiteLocale): Promise<T[]> {
  if (locale === "ru" || !posts.length) return posts;
  const translations = await prisma.localizedContent.findMany({
    where: { key: { in: posts.map((post) => `post:${post.id}`) }, locale, status: "PUBLISHED" },
    select: { key: true, name: true, summary: true, body: true, sourceHash: true },
  });
  const indexed = new Map(translations.map((row) => [row.key, row]));
  return posts.map((post) => {
    const entry = indexed.get(`post:${post.id}`);
    if (!entry || entry.sourceHash !== contentSourceHash(post.title, post.category || "", post.content)) return post;
    return { ...post, title: entry.name, category: entry.summary || post.category, content: entry.body };
  });
}
