import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { getPublicBaseUrl, SITE_BRAND } from "@/lib/siteConfig";
import { collapseRepresentedProductCards } from "@/lib/publicProductCards";
import { serializeJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = {
  params: { slug: string };
};

const CATEGORIES: Record<
  string,
  { label: string; terms: string[]; description: string }
> = {
  kremy: {
    label: "Кремы",
    terms: ["крем", "cream", "creme", "флюид"],
    description: "Профессиональные кремы для ухода за кожей с доставкой по Казахстану.",
  },
  syvorotki: {
    label: "Сыворотки",
    terms: ["сыворот", "serum", "концентрат", "ампул", "ampoule"],
    description: "Профессиональные сыворотки и концентраты для ухода за кожей с доставкой по Казахстану.",
  },
  toniki: {
    label: "Тоники",
    terms: ["тоник", "тонер", "tonic", "toner", "лосьон"],
    description: "Профессиональные тоники, тонеры и лосьоны для ухода за кожей с доставкой по Казахстану.",
  },
};

function categoryFor(slug: string) {
  return CATEGORIES[slug] || null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = categoryFor(params.slug);
  if (!category) {
    return {
      title: `Категория не найдена — ${SITE_BRAND}`,
      robots: { index: false, follow: false },
    };
  }

  const categoryUrl = `${getPublicBaseUrl()}/shop/category/${params.slug}`;
  return {
    title: `${category.label} — купить в Казахстане | ${SITE_BRAND}`,
    description: category.description,
    alternates: { canonical: categoryUrl },
    openGraph: {
      type: "website",
      url: categoryUrl,
      title: `${category.label} — ${SITE_BRAND}`,
      description: category.description,
    },
    twitter: {
      card: "summary",
      title: `${category.label} — ${SITE_BRAND}`,
      description: category.description,
    },
  };
}

export default async function CategoryPage({ params }: Props) {
  const category = categoryFor(params.slug);
  if (!category) notFound();

  const textConditions = category.terms.flatMap((term) => [
    { name: { contains: term, mode: "insensitive" as const } },
    { category: { contains: term, mode: "insensitive" as const } },
    { productLineName: { contains: term, mode: "insensitive" as const } },
  ]);

  const productRows = await prisma.product.findMany({
    where: {
      isPublished: true,
      enrichmentStatus: { not: "MERGED" },
      OR: textConditions,
    },
    include: { brand: true },
    orderBy: { createdAt: "desc" },
  });
  const products = collapseRepresentedProductCards(productRows);

  if (!products.length) notFound();

  const baseUrl = getPublicBaseUrl();
  const categoryUrl = `${baseUrl}/shop/category/${params.slug}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
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
        name: "Каталог",
        item: `${baseUrl}/shop`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: category.label,
        item: categoryUrl,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{category.label}</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">{category.description}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </>
  );
}
