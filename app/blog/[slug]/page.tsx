import { prisma } from "@/lib/prisma";

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await prisma.post.findUnique({ where: { slug: params.slug } });
  if (!post) return <div>Материал не найден</div>;
  return (
    <article className="prose max-w-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {post.image ? <img src={post.image} alt={post.title} className="rounded-3xl border mb-6"/> : null}
      <div className="text-xs text-gray-500 uppercase">{post.category}</div>
      <h1>{post.title}</h1>
      <div className="whitespace-pre-line">{post.content}</div>
    </article>
  );
}
