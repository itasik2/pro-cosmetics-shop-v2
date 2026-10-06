// app/blog/[slug]/page.tsx
import Link from "next/link";
import ArticleContent from "@/components/ArticleContent";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCspNonce } from "@/lib/csp";
import { prisma } from "@/lib/prisma";
import { SITE_BRAND } from "@/lib/siteConfig";
import {
  absolutePublicUrl,
  buildBlogPostingJsonLd,
  buildBreadcrumbJsonLd,
  stringifyJsonLd,
} from "@/lib/structuredData";

type Props = {
  params: Promise<{ slug: string }>;
};

function normalizeSlug(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function buildPostDescription(content: string) {
  const shortBase = content.replace(/\s+/g, " ").trim();
  if (!shortBase) return `Материал блога ${SITE_BRAND}`;
  return shortBase.length > 150 ? `${shortBase.slice(0, 150)}...` : shortBase;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const slug = normalizeSlug(params.slug);

  const post = await prisma.post.findUnique({
    where: { slug },
    select: {
      title: true,
      content: true,
      image: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!post) {
    return {
      title: `Материал не найден — ${SITE_BRAND}`,
      description: "Статья не найдена или была удалена.",
      alternates: { canonical: absolutePublicUrl("/blog") },
      robots: { index: false, follow: false },
    };
  }

  const short = buildPostDescription(post.content);
  const pageUrl = absolutePublicUrl(`/blog/${slug}`);
  const imageUrl = post.image ? absolutePublicUrl(post.image) : undefined;
  const fullTitle = `${post.title} — блог ${SITE_BRAND}`;

  return {
    title: fullTitle,
    description: short,
    alternates: { canonical: pageUrl },
    openGraph: {
      type: "article",
      locale: "ru_KZ",
      title: fullTitle,
      description: short,
      url: pageUrl,
      publishedTime: post.createdAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      images: imageUrl ? [{ url: imageUrl, alt: post.title }] : [],
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: fullTitle,
      description: short,
      images: imageUrl ? [imageUrl] : [],
    },
  };
}

export default async function PostPage(props: Props) {
  const params = await props.params;
  const nonce = await getCspNonce();
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

  const description = buildPostDescription(post.content);
  const articleJsonLd = buildBlogPostingJsonLd({
    title: post.title,
    description,
    slug,
    image: post.image,
    category: post.category,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Главная", url: "/" },
    { name: "Блог", url: "/blog" },
    { name: post.title, url: `/blog/${slug}` },
  ]);

  return (
    <>
      <script
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(articleJsonLd) }}
      />
      <script
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(breadcrumbJsonLd) }}
      />

      <article className="container mx-auto py-8">
        <div className="max-w-none">
          <nav
            aria-label="Хлебные крошки"
            className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-500"
          >
            <Link href="/" className="hover:text-gray-800">
              Главная
            </Link>
            <span aria-hidden="true">/</span>
            <Link href="/blog" className="hover:text-gray-800">
              Блог
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-gray-700" aria-current="page">
              {post.title}
            </span>
          </nav>

          {post.image && (
            <figure className="mb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.image}
                alt={post.title}
                className="rounded-3xl border w-full max-h-[480px] object-cover"
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

          <div className="text-xs text-gray-500 uppercase mb-2">
            {post.category} • {new Date(post.createdAt).toLocaleDateString("ru-RU")}
          </div>

          <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>

          <div className="mt-6"><ArticleContent content={post.content} /></div>

          <div className="mt-8 text-xs text-gray-500">
            Материал носит информационный характер и не заменяет консультацию врача.
          </div>
        </div>
      </article>
    </>
  );
}
