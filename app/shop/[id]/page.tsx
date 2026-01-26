// app/shop/[id]/page.tsx
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import ProductDetailsClient from "./ProductDetailsClient";

type Props = { params: { id: string } };

// SEO: динамический title/description по товару
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { brand: true },
  });

  if (!product) {
    return {
      title: "Товар не найден – pro.cosmetics",
      description: "Товар не найден или был удалён из каталога.",
    };
  }

  const brandName = product.brand?.name ?? "";

  return {
    title: `${product.name} – купить в pro.cosmetics`,
    description: `${brandName ? `${brandName}. ` : ""}Категория: ${product.category}. Цена: ${product.price.toLocaleString(
      "ru-RU",
    )} ₸. Заказать с доставкой по Казахстану.`,
    openGraph: {
      title: `${product.name} – pro.cosmetics`,
      description: `${brandName ? `${brandName}. ` : ""}Категория: ${product.category}.`,
      images: product.image ? [product.image] : [],
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    // можно include оставить, но лучше select для контроля
    select: {
      id: true,
      name: true,
      image: true,
      price: true,
      stock: true,
      description: true,
      category: true,
      variants: true,
      brand: { select: { name: true } },
    },
  });

  if (!product) {
    return <div className="py-10">Товар не найден</div>;
  }

  return <ProductDetailsClient product={product as any} />;
}
