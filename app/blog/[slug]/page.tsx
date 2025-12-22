// app/blog/[slug]/page.tsx
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

type Props = {
  params: { slug: string };
};

function normalizeSlug(raw: string) {
  // decode + unicode normalize для кириллицы
  try {
    return decodeURIComponent(raw).normalize("NFC");
  } catch {
    return raw.normalize("NFC");
  }
}

// SEO: динамический title/description по статье
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = normalizeSlug(params.slug);

  const post = await prisma.post.findUnique({
    where: { slug },
  });

  if (!post) {
    return {
      title: "Материал не найден – pro.cosmetics",
      description: "Статья не найдена или была удалена.",
    };
  }

  const short =
    post.content.slice(0, 150).replace(/\s+/g, " ").trim() + "...";

  return {
    title: `${post.title} – блог pro.cosmetics`,
    description: short,
    openGraph: {
      title: `${post.title} – блог pro.cosmetics`,
      description: short,
      images: post.image ? [post.image] : [],
    },
  };
}

export default async function PostPage({ params }: Props) {
  const slug = normalizeSlug(params.slug);

  const post = await prisma.post.findUnique({
    where: { slug },
  });

  if (!post) notFound();

  return (
    <main className="container mx-auto py-8">
      <article className="prose max-w-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {post.image && (
          <img
            src={post.image}
            alt={post.title}
            className="rounded-3xl border mb-6 w-full max-h-[480px] object-cover"
          />
        )}

        <div className="text-xs text-gray-500 uppercase mb-2">
          {post.category} •{" "}
          {new Date(post.createdAt).toLocaleDateString("ru-RU")}
        </div>

        <h1>{post.title}</h1>

        <div className="whitespace-pre-line">{post.content}</div>
      </article>
    </main>
  );
}
