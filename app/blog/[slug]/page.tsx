// app/blog/[slug]/page.tsx
import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl, SITE_BRAND } from "@/lib/siteConfig";
import { seoDescription, serializeJsonLd } from "@/lib/seo";
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

function parseBoldHeading(line: string) {
  const t = line.trim();
  if (!t.startsWith("**") || !t.endsWith("**")) return null;
  const inner = t.slice(2, -2).trim();
  if (!inner || inner.includes("**")) return null;
  return inner;
}

function parseColonHeading(line: string) {
  const t = line.trim();
  if (!t.endsWith(":")) return null;
  const inner = t.slice(0, -1).trim();
  if (!inner || inner.length < 6) return null;
  if (/^[-•\d]+\s/.test(inner)) return null;
  return inner;
}

function parseHashHeading(line: string) {
  const t = line.trim();
  const m = t.match(/^(#{2,3})\s+(.+?)\s*$/);
  if (!m) return null;
  const level = m[1].length;
  const text = m[2].trim();
  if (!text) return null;
  return { level, text };
}

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
    if (isSeparator(line)) continue;

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
  const baseUrl = getPublicBaseUrl();

  const post = await prisma.post.findUnique({
    where: { slug },
    select: {
      title: true,
      content: true,
      image: true,
      category: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!post) {
    return {
      title: `Материал не найден — ${SITE_BRAND}`,
      description: "Статья не найдена или была удалена.",
      alternates: { canonical: `${baseUrl}/blog` },
      robots: { index: false, follow: false },
    };
  }

  const articleUrl = `${baseUrl}/blog/${encodeURIComponent(slug)}`;
  const short =
    seoDescription(post.content, 160) || `Материал блога ${SITE_BRAND}`;

  return {
    title: `${post.title} — блог ${SITE_BRAND}`,
    description: short,
    alternates: { canonical: articleUrl },
    openGraph: {
      type: "article",
      title: `${post.title} — блог ${SITE_BRAND}`,
      description: short,
      url: articleUrl,
      images: post.image ? [{ url: post.image, alt: post.title }] : [],
      publishedTime: post.createdAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      section: post.category,
    },
    twitter: {
      card: post.image ? "summary_large_image" : "summary",
      title: `${post.title} — ${SITE_BRAND}`,
      description: short,
      images: post.image ? [post.image] : undefined,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const slug = normalizeSlug(params.slug);

  const post = await prisma.post.findUnique({
    where: { slug },
    select: {
      title: true,
      content: true,
      image: true,
      imageCredit: true,
      imageSourceUrl: true,
      imageLicense: true,
      imageLicenseUrl: true,
      category: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!post) notFound();

  const { blocks } = parseContentToBlocks(post.content);
  const baseUrl = getPublicBaseUrl();
  const articleUrl = `${baseUrl}/blog/${encodeURIComponent(slug)}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${articleUrl}#article`,
        headline: post.title,
        description: seoDescription(post.content, 300),
        image: post.image ? [post.image] : undefined,
        datePublished: post.createdAt.toISOString(),
        dateModified: post.updatedAt.toISOString(),
        articleSection: post.category,
        inLanguage: "ru-KZ",
        mainEntityOfPage: articleUrl,
        author: { "@id": `${baseUrl}/#organization` },
        publisher: { "@id": `${baseUrl}/#organization` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${articleUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Главная",
            item: baseUrl,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Блог",
            item: `${baseUrl}/blog`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: post.title,
            item: articleUrl,
          },
        ],
      },
    ],
  };

  return (
    <article className="container mx-auto py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />

      <div className="max-w-none">
        {post.image && (
          <figure className="mb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.image}
              alt={post.title}
              className="max-h-[480px] w-full rounded-3xl border object-cover"
            />
            {post.imageSourceUrl ? (
              <figcaption className="mt-2 text-xs text-gray-500">
                Изображение: {post.imageCredit || "Wikimedia Commons"}
                {post.imageLicense ? (
                  <>
                    {" · "}
                    {post.imageLicenseUrl ? (
                      <a
                        href={post.imageLicenseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2"
                      >
                        {post.imageLicense}
                      </a>
                    ) : (
                      post.imageLicense
                    )}
                  </>
                ) : null}
                {" · "}
                <a
                  href={post.imageSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  источник
                </a>
              </figcaption>
            ) : null}
          </figure>
        )}

        <div className="mb-2 text-xs uppercase text-gray-500">
          {post.category} • {new Date(post.createdAt).toLocaleDateString("ru-RU")}
        </div>

        <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>

        <div className="mt-6 space-y-4">
          {blocks.map((block, idx) => {
            if (block.type === "heading") {
              const className =
                block.level === 3
                  ? "scroll-mt-24 text-lg font-bold md:text-xl"
                  : "scroll-mt-24 text-xl font-bold md:text-2xl";
              const Heading = block.level === 3 ? "h3" : "h2";

              return (
                <Heading key={`${block.id}-${idx}`} id={block.id} className={className}>
                  {block.text}
                </Heading>
              );
            }

            return (
              <div
                key={`p-${idx}`}
                className="whitespace-pre-line leading-relaxed text-gray-800"
              >
                {block.text}
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-xs text-gray-500">
          Материал носит информационный характер и не заменяет консультацию врача.
        </div>
      </div>
    </article>
  );
}
