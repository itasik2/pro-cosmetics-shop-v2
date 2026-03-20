import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import ProductCard from "@/components/ProductCard";
import { getPublicBaseUrl, SITE_BRAND } from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

type Props = {
  params: { slug: string };
};

function decodeCategory(slug: string) {
  return slug.replace(/-/g, " ");
}

export async function generateMetadata({ params }: Props) {
  const categoryName = decodeCategory(params.slug);

  return {
    title: `${categoryName} – купить в Казахстане | ${SITE_BRAND}`,
    description: `Категория ${categoryName}. Профессиональная косметика.`,
    alternates: {
      canonical: `${getPublicBaseUrl()}/shop/category/${params.slug}`,
    },
  };
}

export default async function CategoryPage({ params }: Props) {
  const categoryName = decodeCategory(params.slug);

  const products = await prisma.product.findMany({
    where: {
      category: {
        contains: categoryName,
        mode: "insensitive",
      },
    },
    include: { brand: true },
  });

  if (!products.length) notFound();

  return (
    <main className="space-y-6">
      <h1 className="text-3xl font-bold">{categoryName}</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </main>
  );
}