// app/blog/[slug]/page.tsx
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

type Props = {
  params: { slug: string };
};

export default async function PostPage({ params }: Props) {
  const post = await prisma.post.findUnique({
    where: { slug: params.slug },
  });

  if (!post) {
    notFound();
  }

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

        <div className="whitespace-pre-line">
          {post.content}
        </div>
      </article>
    </main>
  );
}

