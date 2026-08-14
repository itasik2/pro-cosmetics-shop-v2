import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import ProductCard from "@/components/ProductCard";
import { prisma } from "@/lib/prisma";
import { formatProductName } from "@/lib/productNames";
import { collapseRepresentedProductCards } from "@/lib/publicProductCards";
import { productIdentityKey } from "@/lib/price-import/productVariants";
import { buildBrandIntentKeywords } from "@/lib/seo";
import {
  getPublicBaseUrl,
  SITE_BRAND,
  SITE_HERO_SUBTITLE,
  SITE_HERO_TITLE,
  SITE_KEY,
} from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

const REVIEWS_ENABLED =
  process.env.PUBLIC_REVIEWS_ENABLED?.trim().toLowerCase() === "true";

const HERO_TRUST_ITEMS = [
  "Доставка по Казахстану",
  "Подбор по типу и задаче кожи",
  "Способ применения в карточке",
] as const;

const CATALOG_SHORTCUTS = [
  { label: "Кремы", href: "/shop?category=kremy" },
  { label: "Сыворотки", href: "/shop?category=syvorotki" },
  { label: "Тоники", href: "/shop?category=toniki" },
] as const;

const STORE_ADVANTAGES = [
  {
    title: "Профессиональный ассортимент",
    text: "Средства собраны под понятные задачи: очищение, увлажнение, восстановление, anti-age и уход за проблемной кожей.",
  },
  {
    title: "Карточки без догадок",
    text: "Уточняем, что это за средство, для какой кожи оно предназначено, как применяется и с чем сочетается.",
  },
  {
    title: "Польза вместо рекламного шума",
    text: "Объясняем преимущества простым языком и не подменяем подтверждённые свойства обещаниями невозможного результата.",
  },
  {
    title: "Актуальный выбор",
    text: "Следим за интересом к профессиональной косметике и обновлениями источников, чтобы полезные позиции не терялись в каталоге.",
  },
  {
    title: "Только товары магазина",
    text: "В популярные подборки попадают исключительно опубликованные товары из нашего каталога — без сторонней рекламы.",
  },
  {
    title: "Удобный путь к своему уходу",
    text: "Категории, фильтры и содержательные описания помогают сравнить средства и собрать последовательную схему ухода.",
  },
] as const;

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
  brand: { select: { name: true } },
} as const;

type ProductCardRow = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_CARD_SELECT;
}>;
type ReviewRow = Prisma.ReviewGetPayload<Record<string, never>>;

const getHomeBrands = unstable_cache(
  () =>
    prisma.brand.findMany({
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
    }),
  ["home-brands", SITE_KEY],
  { revalidate: 1800 },
);

const getHomeRows = unstable_cache(
  async () => {
    const [popularRows, salesRows, newArrivalRows, reviews] = await Promise.all([
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
      prisma.orderItem.groupBy({
        by: ["productId"],
        where: {
          productId: { not: "" },
          order: { status: { not: "CANCELED" } },
        },
        _sum: { qty: true },
        orderBy: { _sum: { qty: "desc" } },
        take: 40,
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
        : Promise.resolve<ReviewRow[]>([]),
    ]);

    const salesIds = salesRows.map((row) => row.productId);
    const salesProductRows = salesIds.length
      ? await prisma.product.findMany({
          where: {
            id: { in: salesIds },
            isPublished: true,
            stock: { gt: 0 },
            enrichmentStatus: { not: "MERGED" },
          },
          select: PRODUCT_CARD_SELECT,
        })
      : [];

    return { popularRows, salesIds, salesProductRows, newArrivalRows, reviews };
  },
  ["home-products", SITE_KEY, REVIEWS_ENABLED ? "reviews" : "no-reviews"],
  { revalidate: 300 },
);

export async function generateMetadata() {
  const brands = await getHomeBrands();
  const brandNames = brands.map((brand) => brand.name).slice(0, 6).join(", ");
  const baseUrl = getPublicBaseUrl();
  const brandIntentKeywords = buildBrandIntentKeywords(brands, [
    "крем",
    "сыворотка",
    "маска",
  ]);

  return {
    title: `Профессиональная косметика купить в Казахстане | ${SITE_BRAND}`,
    description: `Интернет-магазин ${SITE_BRAND}. Профессиональная косметика: ${brandNames}. Подробные рекомендации и доставка по Казахстану.`,
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
    alternates: { canonical: baseUrl },
    openGraph: {
      title: `Профессиональная косметика | ${SITE_BRAND}`,
      description:
        "Профессиональный уход за кожей с понятными рекомендациями. Доставка по Казахстану.",
      url: baseUrl,
      siteName: SITE_BRAND,
      locale: "ru_KZ",
      type: "website",
    },
  };
}

export default async function Home() {
  const { popularRows, salesIds, salesProductRows, newArrivalRows, reviews } =
    await getHomeRows();

  const salesRank = new Map(salesIds.map((id, index) => [id, index]));
  salesProductRows.sort(
    (left, right) =>
      (salesRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (salesRank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );

  const collapsedPopular = collapseRepresentedProductCards(popularRows);
  const monitoredPopular = collapsedPopular.filter(
    (product) => !product.popularityPinned,
  );
  const manuallyPinnedPopular = collapsedPopular.filter(
    (product) => product.popularityPinned,
  );
  const markedPopular = monitoredPopular.length
    ? [
        ...monitoredPopular.slice(0, 4),
        ...manuallyPinnedPopular.slice(0, 4),
        ...monitoredPopular.slice(4),
        ...manuallyPinnedPopular.slice(4),
      ]
    : manuallyPinnedPopular;
  const fallbackById = new Map(
    [
      ...salesProductRows,
      ...newArrivalRows.filter((product) => product.stock > 0),
      ...newArrivalRows,
    ].map((product) => [product.id, product]),
  );
  const popularCandidates = [
    ...markedPopular,
    ...collapseRepresentedProductCards([...fallbackById.values()]),
  ];
  const popularIdentityKeys = new Set<string>();
  const popular = popularCandidates
    .filter((product) => {
      const key =
        productIdentityKey({
          brandName: product.brand?.name,
          name: product.name,
          volumeValue: product.volumeValue,
          volumeUnit: product.volumeUnit,
        }) || `id:${product.id}`;
      if (popularIdentityKeys.has(key)) return false;
      popularIdentityKeys.add(key);
      return true;
    })
    .slice(0, 8);
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
    <div className="space-y-12">
      <section className="site-panel-muted overflow-hidden rounded-3xl p-6 md:p-10">
        <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div>
            <p className="site-eyebrow">Продуманный уход начинается с выбора</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              {SITE_HERO_TITLE}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-gray-700 sm:text-lg">
              {SITE_HERO_SUBTITLE}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/shop" className="btn">
                Подобрать средства
              </Link>
              <Link href="/about" className="btn-secondary">
                Как мы формируем каталог
              </Link>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600">
              {HERO_TRUST_ITEMS.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <HeroCatalogPreview products={popular.length ? popular : newArrivals} />
        </div>
      </section>

      <ProductSection
        title="Популярные товары"
        subtitle="Подборка из опубликованных товаров каталога: учитываем интерес к позициям, продажи и актуальность ассортимента."
        emptyText="В каталоге пока нет опубликованных товаров."
        products={popular}
      />

      <section className="site-panel-muted overflow-hidden rounded-3xl p-6 md:p-10">
        <div className="max-w-3xl">
          <p className="site-eyebrow">Осознанный выбор</p>
          <h2 className="mt-2 text-2xl font-semibold md:text-3xl">Почему выбирают нас</h2>
          <p className="mt-3 text-gray-700 md:text-lg">
            Профессиональный уход становится проще, когда назначение каждого
            средства понятно до покупки.
          </p>
        </div>
        <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STORE_ADVANTAGES.map((advantage, index) => (
            <article key={advantage.title} className="site-panel rounded-2xl p-5">
              <div className="accent-badge flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold">
                {index + 1}
              </div>
              <h3 className="mt-4 font-semibold text-gray-950">{advantage.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600">{advantage.text}</p>
            </article>
          ))}
        </div>
        <div className="mt-7">
          <Link href="/about" className="btn-secondary">
            Подробнее о магазине
          </Link>
        </div>
      </section>

      <ProductSection
        title="Новинки"
        subtitle="Недавно добавленные позиции для новых задач и обновления привычной схемы ухода."
        emptyText="Пока нет товаров."
        products={newArrivals}
      />

      {REVIEWS_ENABLED ? (
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Отзывы клиентов</h2>
          {reviews.length === 0 ? (
            <div className="text-sm text-gray-500">Пока нет отзывов.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {reviews.map((review) => (
                <article key={review.id} className="site-panel rounded-3xl p-5">
                  <div className="text-sm font-medium">{review.name}</div>
                  <div className="mt-1 text-xs text-gray-500">Оценка: {review.rating}/5</div>
                  <p className="mt-3 whitespace-pre-line text-sm text-gray-700">{review.text}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function HeroCatalogPreview({ products }: { products: ProductCardRow[] }) {
  return (
    <aside className="site-panel rounded-3xl p-5" aria-label="Быстрый переход в каталог">
      <p className="text-sm font-semibold text-gray-950">С чего начать выбор</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {CATALOG_SHORTCUTS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="accent-badge inline-flex min-h-8 items-center justify-center rounded-full px-3 py-1 text-center text-xs font-semibold hover:brightness-95"
          >
            {item.label}
          </Link>
        ))}
      </div>
      {products.length ? (
        <div className="mt-5 border-t border-[var(--color-border)] pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Сейчас в подборке</p>
          <ul className="mt-2 space-y-2">
            {products.slice(0, 3).map((product) => (
              <li key={product.id}>
                <Link
                  href={`/api/products/by-id-redirect/${encodeURIComponent(product.id)}`}
                  className="block rounded-xl px-3 py-2 text-sm font-medium text-gray-800 hover:bg-[var(--color-accent-soft)]"
                >
                  <span className="line-clamp-2">{formatProductName(product.name)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

type ProductSectionProps = {
  title: string;
  subtitle: string;
  emptyText: string;
  products: ProductCardRow[];
};

function ProductSection({ title, subtitle, emptyText, products }: ProductSectionProps) {
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">{subtitle}</p>
        </div>
        <Link href="/shop" className="text-link shrink-0 text-sm">
          Смотреть весь каталог
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="text-sm text-gray-500">{emptyText}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </section>
  );
}
