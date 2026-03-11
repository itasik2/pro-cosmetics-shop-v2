import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const brand = await prisma.brand.findUnique({
    where: { slug: params.slug },
  });

  if (!brand) return {};

  return {
    title: `${brand.name} — купить в Казахстане`,
    description: `Каталог косметики ${brand.name}. Доставка по Казахстану.`,
  };
}

export default async function BrandPage({ params }) {
  const brand = await prisma.brand.findUnique({
    where: { slug: params.slug },
  });

  if (!brand) notFound();

  const products = await prisma.product.findMany({
    where: { brandId: brand.id },
    include: { brand: true },
  });

  return (
    <main className="space-y-6">

      <h1 className="text-3xl font-bold">
        {brand.name}
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>

    </main>
  );
}
