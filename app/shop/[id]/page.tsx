// app/shop/[id]/page.tsx
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";

type Props = { params: { id: string } };

// SEO: динамический title/description по товару
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
  });

  if (!product) {
    return {
      title: "Товар не найден – pro.cosmetics",
      description: "Товар не найден или был удалён из каталога.",
    };
  }

  return {
    title: `${product.name} – купить в pro.cosmetics`,
    description: `${product.brand}. Категория: ${product.category}. Цена: ${product.price.toLocaleString(
      "ru-RU",
    )} ₸. Заказать с доставкой по Казахстану.`,
    openGraph: {
      title: `${product.name} – pro.cosmetics`,
      description: `${product.brand}. Категория: ${product.category}.`,
      images: product.image ? [product.image] : [],
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
  });

  if (!product) {
    return <div className="py-10">Товар не найден</div>;
  }

  return (
    <div className="grid md:grid-cols-2 gap-8 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={product.image}
        alt={product.name}
        className="w-full rounded-3xl border object-cover max-h-[480px]"
      />
      <div className="space-y-4">
        <div className="text-sm text-gray-500">
          {product.brand} • {product.category}
        </div>
        <h1 className="text-3xl font-bold">{product.name}</h1>
        <div className="text-gray-600 whitespace-pre-line">
          {product.description}
        </div>
        <div className="text-2xl font-semibold">
          {product.price.toLocaleString("ru-RU")} ₸
        </div>

        <form action="/checkout" method="GET">
          <input type="hidden" name="id" value={product.id} />
          <button className="btn">В корзину</button>
        </form>

        <Link href="/shop" className="text-sm text-gray-500 hover:underline">
          ← Вернуться в каталог
        </Link>
      </div>
    </div>
  );
}
