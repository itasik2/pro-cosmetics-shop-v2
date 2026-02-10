// app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import { SITE_BRAND, SITE_HERO_SUBTITLE, SITE_HERO_TITLE } from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `${SITE_BRAND} – профессиональная косметика для домашнего ухода`,
  description:
    `Магазин ${SITE_BRAND}: очищение, сыворотки, кремы для лица и тела. Честные составы и понятные описания, доставка по Казахстану.`,
};

export default async function Home() {
  const popular = await prisma.product.findMany({
    where: { isPopular: true },
    include: { brand: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  const newArrivals = await prisma.product.findMany({
    include: { brand: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  const reviews = await prisma.review.findMany({
    where: { isPublic: true },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  return (
    <main className="space-y-10">
      {/* HERO */}
      <section className="rounded-3xl bg-white/70 backdrop-blur border p-10">
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
          <Link href="/shop" className="text-sm text-gray-500 hover:underline">
            Смотреть весь каталог
          </Link>
        </div>

        {popular.length === 0 ? (
          <div className="text-sm text-gray-500">
            Пока нет отмеченных популярных товаров. Отметь нужные позиции в
            админке.
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
          <Link href="/shop" className="text-sm text-gray-500 hover:underline">
            Смотреть весь каталог
          </Link>
        </div>

        {newArrivals.length === 0 ? (
          <div className="text-sm text-gray-500">Пока нет товаров.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {newArrivals.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* ОТЗЫВЫ КЛИЕНТОВ */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold">Отзывы клиентов</h2>
        </div>

        {reviews.length === 0 ? (
          <div className="text-sm text-gray-500">Пока нет отзывов.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-3xl border p-5 bg-white/80 backdrop-blur"
              >
                <div className="text-sm font-medium">{r.name}</div>
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
