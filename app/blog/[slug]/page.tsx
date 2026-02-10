// app/blog/[slug]/page.tsx
import { prisma } from "@/lib/prisma";
import { SITE_BRAND } from "@/lib/siteConfig";
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
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

// 1) Заголовок, если строка целиком вида **...**
function parseBoldHeading(line: string) {
  const t = line.trim();
  if (!t.startsWith("**") || !t.endsWith("**")) return null;
  const inner = t.slice(2, -2).trim();
  if (!inner) return null;
  if (inner.includes("**")) return null;
  return inner;
}

// 2) Заголовок, если строка заканчивается ":" (без спец-символов)
function parseColonHeading(line: string) {
  const t = line.trim();
  if (!t.endsWith(":")) return null;
  const inner = t.slice(0, -1).trim();
  if (!inner) return null;
  if (inner.length < 6) return null;
  if (/^[-•\d]+\s/.test(inner)) return null;
  return inner;
}

// 3) Markdown-подобные заголовки: ## / ###
function parseHashHeading(line: string) {
  const t = line.trim();
  const m = t.match(/^(#{2,3})\s+(.+?)\s*$/);
  if (!m) return null;
  const level = m[1].length; // 2 или 3
  const text = m[2].trim();
  if (!text) return null;
  return { level, text };
}

// 4) Разделитель вида --- (часто в генерации)
function isSeparator(line: string) {
  const t = line.trim();
  return t === "---" || t === "—" || t === "——" || t === "———";
}

type Block =
  | { type: "heading"; text: string; id: string; level: 2 | 3 }
  | { type: "paragraph"; text: string };

function makeUniqueId(base: string, used: Map<string, number>) {
  const n = used.get(base) || 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

function parseContentToBlocks(content: string) {
  const lines = (content || "").replace(/\r/g, "").split("\n");

  const blocks: Block[] = [];
  const toc: { id: string; text: string }[] = [];
  const usedIds = new Map<string, number>();

  let buf: string[] = [];

  const flushParagraph = () => {
    const text = buf.join("\n").trimEnd();
    if (text.trim()) blocks.push({ type: "paragraph", text });
    buf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine ?? "";

    // игнорируем разделители типа ---
    if (isSeparator(line)) continue;

    // поддерживаем 3 формата заголовков
    const hHash = parseHashHeading(line);
    const hText = parseBoldHeading(line) || parseColonHeading(line);

    if (hHash) {
      flushParagraph();
      const baseId = slugToId(hHash.text) || "section";
      const id = makeUniqueId(baseId, usedIds);
      const level: 2 | 3 = hHash.level === 3 ? 3 : 2;

      blocks.push({ type: "heading", text: hHash.text, id, level });
      toc.push({ id, text: hHash.text });
      continue;
    }

    if (hText) {
      flushParagraph();
      const baseId = slugToId(hText) || "section";
      const id = makeUniqueId(baseId, usedIds);

      blocks.push({ type: "heading", text: hText, id, level: 2 });
      toc.push({ id, text: hText });
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
      title: `Материал не найден – ${SITE_BRAND}`,
      description: "Статья не найдена или была удалена.",
      alternates: { canonical: "/blog" },
    };
  }

  const shortBase = post.content.replace(/\s+/g, " ").trim();
  const short =
    (shortBase.length > 0 ? shortBase.slice(0, 150) : `Материал блога ${SITE_BRAND}`) +
    (shortBase.length > 150 ? "..." : "");

  return {
    title: `${post.title} – блог ${SITE_BRAND}`,
    description: short,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: "article",
      title: `${post.title} – блог ${SITE_BRAND}`,
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

    

        {/* Контент */}
        <div className="mt-6 space-y-4">
          {blocks.map((b, idx) => {
            if (b.type === "heading") {
              const cls =
                b.level === 3
                  ? "text-lg md:text-xl font-bold scroll-mt-24"
                  : "text-xl md:text-2xl font-bold scroll-mt-24";

              return (
                <h2 key={`${b.id}-${idx}`} id={b.id} className={cls}>
                  {b.text}
                </h2>
              );
            }

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

        <div className="mt-8 text-xs text-gray-500">
          Материал носит информационный характер и не заменяет консультацию врача.
        </div>
      </article>
    </main>
  );
}
