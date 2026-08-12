// app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import {
  SITE_BRAND,
  SITE_HERO_SUBTITLE,
  SITE_HERO_TITLE,
  getPublicBaseUrl,
} from "@/lib/siteConfig";
import { buildBrandIntentKeywords } from "@/lib/seo";
import { collapseRepresentedProductCards } from "@/lib/publicProductCards";
import { productIdentityKey } from "@/lib/price-import/productVariants";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      products: {
        some: {
          isPublished: true,
          enrichmentStatus: { not: "MERGED" },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true },
  });

  const brandNames = brands.map((brand) => brand.name).slice(0, 6).join(", ");
  const baseUrl = getPublicBaseUrl();
  const brandIntentKeywords = buildBrandIntentKeywords(brands, [
    "крем",
    "сыворотка",
    "маска",
  ]);

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
      ...brands.map((brand) => brand.name),
      ...brandIntentKeywords,
    ],
    alternates: {
      canonical: baseUrl,
    },
    openGraph: {
      title: `Профессиональная косметика | ${SITE_BRAND}`,
      description: "Профессиональный уход за кожей. Доставка по Казахстану.",
      url: baseUrl,
      siteName: SITE_BRAND,
      locale: "ru_KZ",
      type: "website",
    },
  };
}

const PRODUCT_CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  image: true,
  price: true,
  stock: true,
  isPopular: true,
  isNew: true,
  createdAt: true,
  category: true,
  supplierId: true,
  volumeValue: true,
  volumeUnit: true,
  variants: true,
  brand: {
    select: { name: true },
  },
} as const;

export default async function Home() {
  const [popularRows, newArrivalRows, reviews] = await Promise.all([
    prisma.product.findMany({
      where: {
        isPopular: true,
        isPublished: true,
        enrichmentStatus: { not: "MERGED" },
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: PRODUCT_CARD_SELECT,
    }),
    prisma.product.findMany({
      where: {
        isPublished: true,
        enrichmentStatus: { not: "MERGED" },
      },
      orderBy: { createdAt: "desc" },
      take: 32,
      select: PRODUCT_CARD_SELECT,
    }),
    prisma.review.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  const popular = collapseRepresentedProductCards(popularRows).slice(0, 8);
  const popularKeys = new Set(
    popular
      .map((product) =>
        productIdentityKey({
          brandName: product.brand?.name,
          name: product.name,
          volumeValue: product.volumeValue,
          volumeUnit: product.volumeUnit,
        }),
      )
      .filter((value): value is string => Boolean(value)),
  );
  const newArrivals = collapseRepresentedProductCards(newArrivalRows)
    .filter((product) => {
      const key = productIdentityKey({
        brandName: product.brand?.name,
        name: product.name,
        volumeValue: product.volumeValue,
        volumeUnit: product.volumeUnit,
      });
      return !key || !popularKeys.has(key);
    })
    .slice(0, 8);

  return (
    <main className="space-y-10">
      <section className="rounded-3xl bg-white border p-10">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          {SITE_HERO_TITLE}
        </h1>
        <p className="mt-3 text-gray-600 max-w-2xl">{SITE_HERO_SUBTITLE}</p>
        <div className="mt-6">
          <Link href="/shop" className="btn">
            Перейти в каталог
          </Link>
        </div>
      </section>

      <ProductSection
        title="Популярные товары"
        emptyText="Пока нет отмеченных популярных товаров."
        products={popular}
      />

      <ProductSection
        title="Новинки"
        emptyText="Пока нет товаров."
        products={newArrivals}
      />

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Отзывы клиентов</h2>

        {reviews.length === 0 ? (
          <div className="text-sm text-gray-500">Пока нет отзывов.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {reviews.map((review) => (
              <div key={review.id} className="rounded-3xl border p-5 bg-white">
                <div className="text-sm font-medium">{review.name}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Оценка: {review.rating}/5
                </div>
                <p className="text-sm text-gray-700 mt-3 whitespace-pre-line">
                  {review.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

type ProductSectionProps = {
  title: string;
  emptyText: string;
  products: Awaited<ReturnType<typeof getProductCardRows>>;
};

async function getProductCardRows() {
  return prisma.product.findMany({
    where: { isPublished: true, enrichmentStatus: { not: "MERGED" } },
    take: 0,
    select: PRODUCT_CARD_SELECT,
  });
}

function ProductSection({ title, emptyText, products }: ProductSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <Link href="/shop" className="text-sm text-gray-500 hover:underline">
          Смотреть весь каталог
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="text-sm text-gray-500">{emptyText}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </section>
  );
}
