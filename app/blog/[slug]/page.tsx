// app/blog/[slug]/page.tsx
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

type Props = {
  params: { slug: string };
};

function normalizeSlug(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function slugToId(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "") // буквы/цифры/пробел/дефис
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

// Заголовок считается заголовком, если строка целиком вида **...**
function parseBoldHeading(line: string) {
  const t = line.trim();
  if (!t.startsWith("**") || !t.endsWith("**")) return null;
  const inner = t.slice(2, -2).trim();
  if (!inner) return null;
  // если внутри тоже есть ** — считаем это обычным текстом
  if (inner.includes("**")) return null;
  return inner;
}

type Block =
  | { type: "heading"; text: string; id: string }
  | { type: "paragraph"; text: string };

function parseContentToBlocks(content: string) {
  const lines = (content || "").replace(/\r/g, "").split("\n");

  const blocks: Block[] = [];
  const toc: { id: string; text: string }[] = [];

  let buf: string[] = [];

  const flushParagraph = () => {
    const text = buf.join("\n").trimEnd();
    if (text.trim()) blocks.push({ type: "paragraph", text });
    buf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine ?? "";
    const heading = parseBoldHeading(line);

    if (heading) {
      flushParagraph();
      const id = slugToId(heading);
      blocks.push({ type: "heading", text: heading, id });
      toc.push({ id, text: heading });
      continue;
    }

    buf.push(line);
  }

  flushParagraph();
  return { blocks, toc };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = normalizeSlug(params.slug);

  const post = await prisma.post.findUnique({
    where: { slug },
    select: { title: true, content: true, image: true },
  });

  if (!post) {
    return {
      title: "Материал не найден – pro.cosmetics",
      description: "Статья не найдена или была удалена.",
      alternates: { canonical: "/blog" },
    };
  }

  const shortBase = post.content.replace(/\s+/g, " ").trim();
  const short =
    (shortBase.length > 0 ? shortBase.slice(0, 150) : "Материал блога pro.cosmetics") +
    (shortBase.length > 150 ? "..." : "");

  return {
    title: `${post.title} – блог pro.cosmetics`,
    description: short,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: "article",
      title: `${post.title} – блог pro.cosmetics`,
      description: short,
      url: `/blog/${slug}`,
      images: post.image ? [{ url: post.image }] : [],
    },
  };
}

export default async function PostPage({ params }: Props) {
  const slug = normalizeSlug(params.slug);

  const post = await prisma.post.findUnique({
    where: { slug },
    select: { title: true, content: true, image: true, category: true, createdAt: true },
  });

  if (!post) notFound();

  const { blocks, toc } = parseContentToBlocks(post.content);

  return (
    <main className="container mx-auto py-8">
      <article className="max-w-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {post.image && (
          <img
            src={post.image}
            alt={post.title}
            className="rounded-3xl border mb-6 w-full max-h-[480px] object-cover"
          />
        )}

        <div className="text-xs text-gray-500 uppercase mb-2">
          {post.category} • {new Date(post.createdAt).toLocaleDateString("ru-RU")}
        </div>

        <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>

        {/* Кликабельный план */}
        {toc.length > 0 && (
          <div className="mt-5 rounded-2xl border bg-white/70 backdrop-blur p-4">
            <div className="font-semibold mb-2">План</div>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {toc.map((x) => (
                <li key={x.id}>
                  <a className="hover:underline" href={`#${x.id}`}>
                    {x.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Контент */}
        <div className="mt-6 space-y-4">
          {blocks.map((b, idx) => {
            if (b.type === "heading") {
              return (
                <h2
                  key={`${b.id}-${idx}`}
                  id={b.id}
                  className="text-xl md:text-2xl font-bold scroll-mt-24"
                >
                  {b.text}
                </h2>
              );
            }

            // paragraph: сохраняем переносы, как раньше
            return (
              <div
                key={`p-${idx}`}
                className="text-gray-800 whitespace-pre-line leading-relaxed"
              >
                {b.text}
              </div>
            );
          })}
        </div>
      </article>
    </main>
  );
}
