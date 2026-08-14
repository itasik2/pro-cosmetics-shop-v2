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

const REVIEWS_ENABLED =
  process.env.PUBLIC_REVIEWS_ENABLED?.trim().toLowerCase() === "true";

const STORE_ADVANTAGES = [
  {
    title: "Профессиональный ассортимент",
    text: "Подбираем средства не ради количества позиций, а под понятные задачи ухода: очищение, восстановление, увлажнение, anti-age и работу с проблемной кожей.",
  },
  {
    title: "Карточки без догадок",
    text: "Проверяем назначение, тип кожи, способ применения и преимущества по надёжным источникам, чтобы вы понимали, что выбираете и зачем.",
  },
  {
    title: "Польза вместо рекламного шума",
    text: "Объясняем действие продукта простым языком, не подменяя факты громкими обещаниями и шаблонными фразами.",
  },
  {
    title: "Актуальный выбор",
    text: "Следим за обновлениями источников и интересом к профессиональной косметике в сети, чтобы заметные позиции не терялись в каталоге.",
  },
  {
    title: "Только товары из каталога",
    text: "В подборки и популярные позиции попадает только то, что уже представлено в магазине — без рекламы сторонних товаров и случайных рекомендаций.",
  },
  {
    title: "Удобный путь к своему уходу",
    text: "Категории, фильтры и содержательные описания помогают быстрее сравнить средства и собрать последовательный домашний уход.",
  },
] as const;

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
  shortDescription: true,
  price: true,
  stock: true,
  isPopular: true,
  popularityPinned: true,
  popularityScore: true,
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
      orderBy: [
        { popularityPinned: "desc" },
        { popularityScore: "desc" },
        { createdAt: "desc" },
      ],
      take: 40,
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
    REVIEWS_ENABLED
      ? prisma.review.findMany({
          where: { isPublic: true },
          orderBy: { createdAt: "desc" },
          take: 6,
        })
      : Promise.resolve([]),
  ]);

  const collapsedPopular = collapseRepresentedProductCards(popularRows);
  const monitoredPopular = collapsedPopular.filter(
    (product) => !product.popularityPinned,
  );
  const manuallyPinnedPopular = collapsedPopular.filter(
    (product) => product.popularityPinned,
  );
  const popular = (monitoredPopular.length
    ? [
        ...monitoredPopular.slice(0, 4),
        ...manuallyPinnedPopular.slice(0, 4),
        ...monitoredPopular.slice(4),
        ...manuallyPinnedPopular.slice(4),
      ]
    : manuallyPinnedPopular
  ).slice(0, 8);
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

      <section className="overflow-hidden rounded-3xl border border-rose-100 bg-gradient-to-br from-rose-50 via-white to-amber-50 p-6 md:p-10">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-700">
            Осознанный выбор
          </div>
          <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
            Почему выбирают нас
          </h2>
          <p className="mt-3 text-gray-700 md:text-lg">
            Мы хотим, чтобы профессиональный уход был понятным: без случайных
            покупок, неподтверждённых обещаний и долгого поиска нужной
            информации.
          </p>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STORE_ADVANTAGES.map((advantage, index) => (
            <article
              key={advantage.title}
              className="rounded-2xl border border-white/80 bg-white/85 p-5 shadow-sm"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-800">
                {index + 1}
              </div>
              <h3 className="mt-4 font-semibold text-gray-950">
                {advantage.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                {advantage.text}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-7">
          <Link href="/about" className="btn">
            Подробнее о магазине
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

      {REVIEWS_ENABLED && (
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Отзывы клиентов</h2>

          {reviews.length === 0 ? (
            <div className="text-sm text-gray-500">Пока нет отзывов.</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {reviews.map((review) => (
                <div key={review.id} className="rounded-3xl border bg-white p-5">
                  <div className="text-sm font-medium">{review.name}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    Оценка: {review.rating}/5
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm text-gray-700">
                    {review.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
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
