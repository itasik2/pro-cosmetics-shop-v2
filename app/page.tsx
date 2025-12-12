// app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const popular = await prisma.product.findMany({
     where: { isPopular: true } as any,
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return (
    <main className="space-y-10">
      {/* HERO */}
      <section className="rounded-3xl bg-gradient-to-br from-gray-100 to-white border p-10">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          Профессиональная косметика с любовью для Вас!
        </h1>
        <p className="mt-3 text-gray-600 max-w-2xl">
          Только проверенные позиции. Нормальные составы, честные описания и цены без магии маркетинга.
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
            Пока нет отмеченных популярных товаров. Отметьте нужные позиции в админке.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {popular.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
