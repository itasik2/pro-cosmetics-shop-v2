import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import { buildBrandIntentKeywords } from "@/lib/seo";

export const dynamic = "force-dynamic";

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

  return {
    title: `Блог и новости – ${SITE_BRAND}`,
    description:
      `Статьи по уходу за кожей, разборы составов и новости магазина ${SITE_BRAND}.`,
    keywords: [
      "блог о косметике",
      "как выбрать крем",
      "уход за кожей советы",
      ...posts.map((p) => p.title),
      ...posts.map((p) => `${p.category} блог`).filter(Boolean),
      ...buildBrandIntentKeywords(brands, ["крем", "уход"]).slice(0, 20),
    ],
    alternates: {
      canonical: `${baseUrl}/blog`,
    },
  };
}

export default async function BlogIndex() {
  const posts = await prisma.post.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Блог и новости</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {posts.map((p)=> (
          <Link key={p.id} href={`/blog/${p.slug}`} className="card block hover:shadow-md transition">
            <div className="aspect-[16/9] w-full bg-gray-100 rounded-xl mb-3 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.image ?? '/seed/post1.jpg'} alt={p.title} className="w-full h-full object-cover"/>
            </div>
            <div className="text-xs text-gray-500 uppercase">{p.category}</div>
            <h3 className="font-semibold">{p.title}</h3>
          </Link>
        ))}
      </div>
    </div>
  );
}
