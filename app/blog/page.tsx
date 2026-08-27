import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import { buildBrandIntentKeywords } from "@/lib/seo";

export const revalidate = 600;

export async function generateMetadata() {
  const [posts, brands] = await Promise.all([
    prisma.post.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { title: true, category: true },
    }),
    prisma.brand.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { name: true },
    }),
  ]);

  const baseUrl = getPublicBaseUrl();
  const blogUrl = `${baseUrl}/blog`;
  const description = `Статьи по уходу за кожей, разборы косметики и новости магазина ${SITE_BRAND}.`;

  return {
    title: `Блог и новости — ${SITE_BRAND}`,
    description,
    keywords: [
      "блог о косметике",
      "как выбрать крем",
      "уход за кожей советы",
      ...posts.map((p) => p.title),
      ...posts.map((p) => `${p.category} блог`).filter(Boolean),
      ...buildBrandIntentKeywords(brands, ["крем", "уход"]).slice(0, 20),
    ],
    alternates: {
      canonical: blogUrl,
    },
    openGraph: {
      type: "website",
      url: blogUrl,
      title: `Блог и новости — ${SITE_BRAND}`,
      description,
    },
    twitter: {
      card: "summary",
      title: `Блог и новости — ${SITE_BRAND}`,
      description,
    },
  };
}

export default async function BlogIndex() {
  const posts = await prisma.post.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Блог и новости</h1>
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.id}
            href={`/blog/${encodeURIComponent(post.slug)}`}
            className="card block transition hover:shadow-md"
          >
            {post.image ? (
              <div className="mb-3 aspect-[16/9] w-full overflow-hidden rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.image}
                  alt={post.title}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            ) : null}
            <div className="text-xs uppercase text-gray-500">{post.category}</div>
            <h2 className="font-semibold">{post.title}</h2>
          </Link>
        ))}
      </div>
    </div>
  );
}
