import Link from "next/link";
import ShopGridClient from "@/components/ShopGridClient";
import FavoritesButton from "@/components/FavoritesButton";
import InStockButton from "@/components/InStockButton";
import NewProductsFilter from "@/components/NewProductsFilter";
import CatalogFacetFilters from "@/components/CatalogFacetFilters";
import { SITE_BRAND, getPublicBaseUrl } from "@/lib/siteConfig";
import { buildBrandIntentKeywords } from "@/lib/seo";
import { CATEGORY_OPTIONS, CARE_OPTIONS } from "@/lib/catalogFilters";
import { firstParam, parseSlugList, parseCatalogQuery, getCatalogBrands, getCatalogData } from "@/lib/publicCatalog";
import { catalogBatch } from "@/lib/catalogBatch";
import { CATALOG_INITIAL_SIZE } from "@/lib/progressiveList";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{
    brand?: string | string[];
    category?: string | string[];
    sort?: string | string[];
    page?: string | string[];
    fav?: string | string[];
    instock?: string | string[];
    q?: string | string[];
    care?: string | string[];
    maxPrice?: string | string[];
  }>;
};

function findCategory(slug: string) {
  return CATEGORY_OPTIONS.find((item) => item.slug === slug) ?? null;
}

export async function generateMetadata(props: Props) {
  const searchParams = await props.searchParams;
  const brandSlugs = parseSlugList(searchParams?.brand);
  const categorySlugs = parseSlugList(searchParams?.category);
  const brandSlug = brandSlugs.length === 1 ? brandSlugs[0] : "";
  const categorySlug = categorySlugs.length === 1 ? categorySlugs[0] : "";
  const sort = firstParam(searchParams?.sort);
  const fav = firstParam(searchParams?.fav);
  const instock = firstParam(searchParams?.instock);
  const searchQuery = firstParam(searchParams?.q);

  const brands = await getCatalogBrands();

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

  if (
    selectedBrand &&
    selectedCategory &&
    brandSlugs.length === 1 &&
    categorySlugs.length === 1
  ) {
    return {
      title: `${selectedBrand.name}: ${selectedCategory.label.toLowerCase()} — купить в Казахстане | ${SITE_BRAND}`,
      description: `${selectedCategory.label} ${selectedBrand.name}. Профессиональная косметика с доставкой по Казахстану.`,
      alternates: {
        canonical: `${baseUrl}/shop?brand=${selectedBrand.slug}&category=${selectedCategory.slug}`,
      },
      robots: { index: false, follow: true },
    };
  }

  if (selectedCategory && brandSlugs.length === 0 && categorySlugs.length === 1) {
    return {
      title: `${selectedCategory.label} — купить в Казахстане | ${SITE_BRAND}`,
      description: `${selectedCategory.label} профессиональных косметических брендов с доставкой по Казахстану.`,
      alternates: {
        canonical: `${baseUrl}/shop?category=${selectedCategory.slug}`,
      },
      robots: { index: false, follow: true },
    };
  }

  if (selectedBrand && brandSlugs.length === 1 && categorySlugs.length === 0) {
    return {
      title: `${selectedBrand.name} — купить в Казахстане | ${SITE_BRAND}`,
      description: `Каталог профессиональной косметики ${selectedBrand.name}.`,
      alternates: {
        canonical: `${baseUrl}/shop?brand=${selectedBrand.slug}`,
      },
      robots: { index: false, follow: true },
    };
  }

  return {
    title: `Профессиональная косметика — каталог брендов | ${SITE_BRAND}`,
    description: `Каталог профессиональной косметики: ${brandNames}. Подробные описания и доставка по Казахстану.`,
    keywords: ["каталог косметики", "купить косметику", ...brandIntentKeywords],
    alternates: {
      canonical: `${baseUrl}/shop`,
    },
    robots:
      sort ||
      fav ||
      instock ||
      searchQuery ||
      firstParam(searchParams?.care) ||
      firstParam(searchParams?.maxPrice) ||
      brandSlugs.length > 0 ||
      categorySlugs.length > 0
        ? { index: false, follow: true }
        : undefined,
  };
}

export default async function ShopPage(props: Props) {
  const query = parseCatalogQuery(await props.searchParams);
  const { care, maxPrice, sort, fav, instock, searchQuery } = query;
  const selectedCare = CARE_OPTIONS.find((option) => option.slug === care);
  const { selectedBrands, selectedCategories, brands, products: productsForClient } = await getCatalogData(query);
  const brandSlug = selectedBrands.map((brand) => brand.slug).join(",");
  const categorySlug = selectedCategories.map((category) => category.slug).join(",");

  const brandSummary =
    selectedBrands.length === 0
      ? "Все бренды"
      : selectedBrands.length === 1
        ? selectedBrands[0].name
        : `Брендов: ${selectedBrands.length}`;
  const categorySummary =
    selectedCategories.length === 0
      ? "Все категории"
      : selectedCategories.length === 1
        ? selectedCategories[0].label
        : `Категорий: ${selectedCategories.length}`;

  return (
    <div className="space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-bold">Каталог</h1>
        <div className="mt-1 text-sm text-gray-500">
          {brandSummary} • {categorySummary} • {productsForClient.length} поз.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/care" className="btn-secondary">Подобрать уход</Link>
        {(selectedCare || maxPrice !== null) && <div className="rounded-xl border bg-white p-3 text-sm">
          {selectedCare?.label}{selectedCare && maxPrice !== null ? " • " : ""}
          {maxPrice !== null && `До ${maxPrice.toLocaleString("ru-RU")} ₸ за средство`}
          <Link href="/shop" className="ml-3 underline">Сбросить подбор</Link>
        </div>}
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
        {selectedCare && <input type="hidden" name="care" value={selectedCare.slug} />}
        {maxPrice !== null && <input type="hidden" name="maxPrice" value={maxPrice} />}
        {brandSlug && <input type="hidden" name="brand" value={brandSlug} />}
        {categorySlug && <input type="hidden" name="category" value={categorySlug} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        {fav === "1" && <input type="hidden" name="fav" value="1" />}
        {instock === "1" && <input type="hidden" name="instock" value="1" />}
        <button type="submit" className="btn">Найти</button>
        {searchQuery && (
          <Link
            href={buildHref(brandSlug, categorySlug, sort, fav, instock, "", care, maxPrice)}
            className="inline-flex min-h-8 items-center justify-center rounded-full border px-3 py-1 text-center text-sm hover:bg-gray-50"
          >
            Очистить
          </Link>
        )}
      </form>

      <div className="flex flex-col gap-3 rounded-2xl border bg-white/70 p-3 sm:p-4 lg:flex-row lg:items-start lg:justify-between">
        <CatalogFacetFilters
          brands={brands.map((brand) => ({ slug: brand.slug, label: brand.name }))}
          categories={CATEGORY_OPTIONS.map((category) => ({
            slug: category.slug,
            label: category.label,
          }))}
        />

        <div className="flex flex-wrap items-center gap-2">
          <NewProductsFilter />
          <InStockButton />
          <FavoritesButton />
        </div>
      </div>

      {searchQuery && (
        <div className="text-sm text-gray-500">
          По запросу «{searchQuery}» найдено: {productsForClient.length}
        </div>
      )}

      <ShopGridClient batch={catalogBatch(productsForClient, CATALOG_INITIAL_SIZE, undefined, fav === "1" ? [] : undefined)} source={{ kind: "catalog", query }} />
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
  care = "",
  maxPrice: number | null = null,
) {
  const params = new URLSearchParams();

  if (brandSlug) params.set("brand", brandSlug);
  if (categorySlug) params.set("category", categorySlug);
  if (sort) params.set("sort", sort);
  if (fav === "1") params.set("fav", "1");
  if (instock === "1") params.set("instock", "1");
  if (searchQuery) params.set("q", searchQuery);
  if (care) params.set("care", care);
  if (maxPrice !== null) params.set("maxPrice", String(maxPrice));

  const query = params.toString();
  return query ? `/shop?${query}` : "/shop";
}
