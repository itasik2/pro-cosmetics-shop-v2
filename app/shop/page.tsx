// app/shop/page.tsx
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ShopGridClient from "@/components/ShopGridClient";
import FavoritesButton from "@/components/FavoritesButton";
import InStockButton from "@/components/InStockButton";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import { buildBrandIntentKeywords } from "@/lib/seo";
import { collapseRepresentedProductCards } from "@/lib/publicProductCards";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: {
    brand?: string;
    category?: string;
    sort?: string;
    fav?: string;
    instock?: string;
    q?: string;
  };
};

type CategoryOption = {
  slug: string;
  label: string;
  searchTerms: string[];
};

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    slug: "kremy",
    label: "Кремы",
    searchTerms: ["крем", "флюид"],
  },
  {
    slug: "syvorotki",
    label: "Сыворотки",
    searchTerms: ["сыворотка"],
  },
  {
    slug: "toniki",
    label: "Тоники",
    searchTerms: ["тоник", "тонер", "лосьон"],
  },
];

function findCategory(slug: string) {
  return CATEGORY_OPTIONS.find((item) => item.slug === slug) ?? null;
}

function normalizeSearch(value: unknown) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productMatchesSearch(
  product: {
    name: string;
    category: string;
    supplierSku: string | null;
    brand: { name: string } | null;
    variants: unknown;
  },
  query: string,
) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;

  const variantParts: string[] = [];
  if (Array.isArray(product.variants)) {
    for (const raw of product.variants) {
      if (!raw || typeof raw !== "object") continue;
      const variant = raw as Record<string, unknown>;
      if (typeof variant.label === "string") variantParts.push(variant.label);
      if (typeof variant.sku === "string") variantParts.push(variant.sku);
    }
  }

  const haystack = normalizeSearch([
    product.name,
    product.brand?.name,
    product.category,
    product.supplierSku,
    ...variantParts,
  ].filter(Boolean).join(" "));

  return normalizedQuery.split(" ").every((token) => haystack.includes(token));
}

export async function generateMetadata({ searchParams }: Props) {
  const brandSlug = (searchParams?.brand || "").trim();
  const categorySlug = (searchParams?.category || "").trim();
  const sort = (searchParams?.sort || "").trim();
  const searchQuery = (searchParams?.q || "").trim();

  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true, slug: true },
  });

  const selectedBrand = brandSlug
    ? brands.find((brand) => brand.slug === brandSlug) || null
    : null;
  const selectedCategory = findCategory(categorySlug);

  const brandNames = brands.map((brand) => brand.name).slice(0, 6).join(", ");
  const baseUrl = getPublicBaseUrl();
  const brandIntentKeywords = buildBrandIntentKeywords(brands, [
    "крем",
    "тоник",
    "сыворотка",
  ]);

  if (selectedBrand && selectedCategory) {
    return {
      title: `${selectedBrand.name}: ${selectedCategory.label.toLowerCase()} – купить в Казахстане | ${SITE_BRAND}`,
      description: `${selectedCategory.label} ${selectedBrand.name}. Профессиональная косметика с доставкой по Казахстану.`,
      alternates: {
        canonical: `${baseUrl}/shop?brand=${selectedBrand.slug}&category=${selectedCategory.slug}`,
      },
      robots: { index: false, follow: true },
    };
  }

  if (selectedCategory) {
    return {
      title: `${selectedCategory.label} – купить в Казахстане | ${SITE_BRAND}`,
      description: `${selectedCategory.label} профессиональных косметических брендов с доставкой по Казахстану.`,
      alternates: {
        canonical: `${baseUrl}/shop?category=${selectedCategory.slug}`,
      },
      robots: { index: false, follow: true },
    };
  }

  if (selectedBrand) {
    return {
      title: `${selectedBrand.name} – купить в Казахстане | ${SITE_BRAND}`,
      description: `Каталог профессиональной косметики ${selectedBrand.name}.`,
      alternates: {
        canonical: `${baseUrl}/shop?brand=${selectedBrand.slug}`,
      },
      robots: { index: false, follow: true },
    };
  }

  return {
    title: `Профессиональная косметика – каталог брендов | ${SITE_BRAND}`,
    description: `Каталог профессиональной косметики: ${brandNames}. Доставка по Казахстану. Оригинальная продукция и честные составы.`,
    keywords: ["каталог косметики", "купить косметику", ...brandIntentKeywords],
    alternates: {
      canonical: `${baseUrl}/shop`,
    },
    robots: sort || searchQuery ? { index: false, follow: true } : undefined,
  };
}

type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
  image?: string;
};

function toVariants(value: unknown): Variant[] | null {
  if (!Array.isArray(value)) return null;

  const variants: Variant[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;

    const object = item as Record<string, unknown>;
    const id = typeof object.id === "string" ? object.id : null;
    const label = typeof object.label === "string" ? object.label : null;
    const price =
      typeof object.price === "number" ? object.price : Number(object.price);
    const stock =
      typeof object.stock === "number" ? object.stock : Number(object.stock);

    if (!id || !label) continue;
    if (!Number.isFinite(price) || !Number.isFinite(stock)) continue;

    variants.push({
      id,
      label,
      price: Math.max(0, Math.trunc(price)),
      stock: Math.max(0, Math.trunc(stock)),
      sku: typeof object.sku === "string" ? object.sku : undefined,
      image: typeof object.image === "string" ? object.image : undefined,
    });
  }

  return variants.length ? variants : null;
}

export default async function ShopPage({ searchParams }: Props) {
  const brandSlug = (searchParams?.brand || "").trim();
  const categorySlug = (searchParams?.category || "").trim();
  const sort = (searchParams?.sort || "").trim();
  const fav = (searchParams?.fav || "").trim();
  const instock = (searchParams?.instock || "").trim();
  const searchQuery = (searchParams?.q || "").trim().slice(0, 120);

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
    select: { id: true, name: true, slug: true },
  });

  const selectedBrand = brandSlug
    ? brands.find((brand) => brand.slug === brandSlug) || null
    : null;
  const selectedCategory = findCategory(categorySlug);

  const andConditions: Prisma.ProductWhereInput[] = [];
  if (selectedCategory) {
    andConditions.push({
      OR: selectedCategory.searchTerms.map((term) => ({
        category: {
          contains: term,
          mode: "insensitive",
        },
      })),
    });
  }

  if (sort === "new") {
    const days = 14;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    andConditions.push({
      OR: [{ isNew: true }, { createdAt: { gte: from } }],
    });
  }

  const where: Prisma.ProductWhereInput = {
    isPublished: true,
    enrichmentStatus: { not: "MERGED" },
    ...(selectedBrand ? { brandId: selectedBrand.id } : {}),
    ...(instock === "1" ? { stock: { gt: 0 } } : {}),
    ...(andConditions.length ? { AND: andConditions } : {}),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    sort === "price_asc"
      ? [{ price: "asc" }, { createdAt: "desc" }]
      : sort === "price_desc"
        ? [{ price: "desc" }, { createdAt: "desc" }]
        : [{ createdAt: "desc" }];

  const products = await prisma.product.findMany({
    where,
    orderBy,
    select: {
      id: true,
      slug: true,
      name: true,
      image: true,
      shortDescription: true,
      price: true,
      stock: true,
      isPopular: true,
      isNew: true,
      createdAt: true,
      category: true,
      supplierSku: true,
      supplierId: true,
      volumeValue: true,
      volumeUnit: true,
      brand: { select: { name: true } },
      variants: true,
    },
  });

  const productsForClient = collapseRepresentedProductCards(products)
    .filter((product) => productMatchesSearch(product, searchQuery))
    .map((product) => ({
      ...product,
      variants: toVariants(product.variants),
    }));

  return (
    <div className="space-y-6 py-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Каталог</h1>
          <div className="mt-1 text-sm text-gray-500">
            {selectedBrand ? `Бренд: ${selectedBrand.name}` : "Все бренды"} •{" "}
            {productsForClient.length} поз.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <SortLink
            currentBrand={brandSlug}
            currentCategory={categorySlug}
            currentSort={sort}
            currentFav={fav}
            currentInStock={instock}
            currentQuery={searchQuery}
            value="new"
          >
            Новинки
          </SortLink>
          <SortLink
            currentBrand={brandSlug}
            currentCategory={categorySlug}
            currentSort={sort}
            currentFav={fav}
            currentInStock={instock}
            currentQuery={searchQuery}
            value="price_asc"
          >
            Цена ↑
          </SortLink>
          <SortLink
            currentBrand={brandSlug}
            currentCategory={categorySlug}
            currentSort={sort}
            currentFav={fav}
            currentInStock={instock}
            currentQuery={searchQuery}
            value="price_desc"
          >
            Цена ↓
          </SortLink>
          <InStockButton />
          <FavoritesButton />
        </div>
      </div>

      <form action="/shop" method="get" className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            type="search"
            name="q"
            defaultValue={searchQuery}
            placeholder="Поиск по названию, бренду, SKU или объёму"
            className="w-full rounded-2xl border bg-white px-4 py-3 pr-10 text-sm outline-none transition focus:border-gray-500"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
        </div>
        {brandSlug && <input type="hidden" name="brand" value={brandSlug} />}
        {categorySlug && <input type="hidden" name="category" value={categorySlug} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        {fav === "1" && <input type="hidden" name="fav" value="1" />}
        {instock === "1" && <input type="hidden" name="instock" value="1" />}
        <button type="submit" className="btn px-5 py-3">Найти</button>
        {searchQuery && (
          <Link
            href={buildHref(brandSlug, categorySlug, sort, fav, instock, "")}
            className="rounded-xl border px-4 py-3 text-center text-sm hover:bg-gray-50"
          >
            Очистить
          </Link>
        )}
      </form>

      {searchQuery && (
        <div className="text-sm text-gray-500">
          По запросу «{searchQuery}» найдено: {productsForClient.length}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <FilterLink
          isActive={!brandSlug}
          href={buildHref("", categorySlug, sort, fav, instock, searchQuery)}
        >
          Все бренды
        </FilterLink>

        {brands.map((brand) => (
          <FilterLink
            key={brand.id}
            isActive={brand.slug === brandSlug}
            href={buildHref(brand.slug, categorySlug, sort, fav, instock, searchQuery)}
          >
            {brand.name}
          </FilterLink>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterLink
          isActive={!categorySlug}
          href={buildHref(brandSlug, "", sort, fav, instock, searchQuery)}
        >
          Все категории
        </FilterLink>

        {CATEGORY_OPTIONS.map((category) => (
          <FilterLink
            key={category.slug}
            isActive={categorySlug === category.slug}
            href={buildHref(brandSlug, category.slug, sort, fav, instock, searchQuery)}
          >
            {category.label}
          </FilterLink>
        ))}
      </div>

      <ShopGridClient products={productsForClient} />
    </div>
  );
}

function buildHref(
  brandSlug: string,
  categorySlug: string,
  sort: string,
  fav: string,
  instock: string,
  searchQuery = "",
) {
  const params = new URLSearchParams();

  if (brandSlug) params.set("brand", brandSlug);
  if (categorySlug) params.set("category", categorySlug);
  if (sort) params.set("sort", sort);
  if (fav === "1") params.set("fav", "1");
  if (instock === "1") params.set("instock", "1");
  if (searchQuery) params.set("q", searchQuery);

  const query = params.toString();
  return query ? `/shop?${query}` : "/shop";
}

function FilterLink({
  href,
  isActive,
  children,
}: {
  href: string;
  isActive: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "rounded-full border px-3 py-1 text-sm " +
        (isActive
          ? "border-black bg-black text-white"
          : "bg-white text-gray-700 hover:bg-gray-50")
      }
    >
      {children}
    </Link>
  );
}

function SortLink({
  currentBrand,
  currentCategory,
  currentSort,
  currentFav,
  currentInStock,
  currentQuery,
  value,
  children,
}: {
  currentBrand: string;
  currentCategory: string;
  currentSort: string;
  currentFav: string;
  currentInStock: string;
  currentQuery: string;
  value: string;
  children: React.ReactNode;
}) {
  const isActive = currentSort === value;
  const nextSort = isActive ? "" : value;

  return (
    <Link
      href={buildHref(
        currentBrand,
        currentCategory,
        nextSort,
        currentFav,
        currentInStock,
        currentQuery,
      )}
      className={
        "rounded-full border px-3 py-1 text-sm " +
        (isActive
          ? "border-black bg-black text-white"
          : "bg-white text-gray-700 hover:bg-gray-50")
      }
    >
      {children}
    </Link>
  );
}
