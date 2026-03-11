// app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import {
  SITE_BRAND,
  SITE_HERO_SUBTITLE,
  SITE_HERO_TITLE,
} from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

/* ===========================
   SEO: ДИНАМИЧЕСКИЕ МЕТАДАННЫЕ
=========================== */

export async function generateMetadata() {
  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true },
  });

  const brandNames = brands.map((b) => b.name).slice(0, 6).join(", ");

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.procosmetics.kz";

  return {
    title: `Профессиональная косметика купить в Казахстане | ${SITE_BRAND}`,
    description: `Интернет-магазин ${SITE_BRAND}. Профессиональная косметика: ${brandNames}. Оригинальная продукция, доставка по Казахстану.`,
    keywords: [
      "профессиональная косметика",
      "косметика для лица",
      "уход за кожей",
      "купить косметику",
      "интернет магазин косметики",
      "косметика Казахстан",
      SITE_BRAND,
      ...brands.map((b) => b.name),
    ],
    alternates: {
      canonical: baseUrl,
    },
    openGraph: {
      title: `Профессиональная косметика | ${SITE_BRAND}`,
      description: `Профессиональный уход за кожей. Доставка по Казахстану.`,
      url: baseUrl,
      siteName: SITE_BRAND,
      locale: "ru_KZ",
      type: "website",
    },
  };
}

/* ===========================
   СТРАНИЦА
=========================== */

export default async function Home() {

  const popular = await prisma.product.findMany({
    where: { isPopular: true },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      slug: true,
      name: true,
      image: true,
      price: true,
      stock: true,
      isPopular: true,
      createdAt: true,
      category: true,
      variants: true,
      brand: {
        select: { name: true },
      },
    },
  });

  const newArrivals = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      slug: true,
      name: true,
      image: true,
      price: true,
      stock: true,
      isPopular: true,
      createdAt: true,
      category: true,
      variants: true,
      brand: {
        select: { name: true },
      },
    },
  });

  const reviews = await prisma.review.findMany({
    where: { isPublic: true },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  return (
    <main className="space-y-10">

      {/* HERO */}
      <section className="rounded-3xl bg-white border p-10">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          {SITE_HERO_TITLE}
        </h1>
        <p className="mt-3 text-gray-600 max-w-2xl">
          {SITE_HERO_SUBTITLE}
        </p>
        <div className="mt-6">
          <Link href="/shop" className="btn">
            Перейти в каталог
          </Link>
        </div>
      </section>

      {/* ПОПУЛЯРНЫЕ ТОВАРЫ */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold">Популярные товары</h2>
          <Link
            href="/shop"
            className="text-sm text-gray-500 hover:underline"
          >
            Смотреть весь каталог
          </Link>
        </div>

        {popular.length === 0 ? (
          <div className="text-sm text-gray-500">
            Пока нет отмеченных популярных товаров.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {popular.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* НОВИНКИ */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold">Новинки</h2>
          <Link
            href="/shop"
            className="text-sm text-gray-500 hover:underline"
          >
            Смотреть весь каталог
          </Link>
        </div>

        {newArrivals.length === 0 ? (
          <div className="text-sm text-gray-500">
            Пока нет товаров.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {newArrivals.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* ОТЗЫВЫ */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">
          Отзывы клиентов
        </h2>

        {reviews.length === 0 ? (
          <div className="text-sm text-gray-500">
            Пока нет отзывов.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-3xl border p-5 bg-white"
              >
                <div className="text-sm font-medium">
                  {r.name}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Оценка: {r.rating}/5
                </div>
                <p className="text-sm text-gray-700 mt-3 whitespace-pre-line">
                  {r.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

    </main>
  );
}
