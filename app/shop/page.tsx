// app/shop/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ShopGridClient from "@/components/ShopGridClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Каталог – pro.cosmetics",
  description:
    "Каталог профессиональной косметики pro.cosmetics: очищающие гели, пенки, сыворотки, кремы и другие средства для ухода за кожей.",
};

type Props = {
  searchParams?: {
    brand?: string;
    sort?: string;
  };
};

export default async function ShopPage({ searchParams }: Props) {
  const brandSlug = (searchParams?.brand || "").trim();
  const sort = (searchParams?.sort || "new").trim();

  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true },
  });

  const selectedBrand = brandSlug
    ? brands.find((b) => b.slug === brandSlug) || null
    : null;

  const orderBy =
    sort === "price_asc"
      ? [{ price: "asc" as const }, { createdAt: "desc" as const }]
      : sort === "price_desc"
      ? [{ price: "desc" as const }, { createdAt: "desc" as const }]
      : [{ createdAt: "desc" as const }];

  const products = await prisma.product.findMany({
    where: selectedBrand ? { brandId: selectedBrand.id } : undefined,
    orderBy,
    select: {
      id: true,
      name: true,
      image: true,
      price: true,
      stock: true,
      isPopular: true,
      createdAt: true,
      category: true,
      brand: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-6 py-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Каталог</h2>
          <div className="text-sm text-gray-500 mt-1">
            {selectedBrand ? `Бренд: ${selectedBrand.name}` : "Все бренды"} •{" "}
            {products.length} поз.
          </div>
        </div>

        {/* Сортировка */}
        <div className="flex flex-wrap gap-2 text-sm">
          <SortLink currentBrand={brandSlug} currentSort={sort} value="new">
            Новинки
          </SortLink>
          <SortLink currentBrand={brandSlug} currentSort={sort} value="price_asc">
            Цена ↑
          </SortLink>
          <SortLink currentBrand={brandSlug} currentSort={sort} value="price_desc">
            Цена ↓
          </SortLink>
        </div>
      </div>

      {/* Фильтр по бренду */}
      <div className="flex flex-wrap gap-2">
        <BrandLink isActive={!brandSlug} href={buildHref("", sort)}>
          Все
        </BrandLink>

        {brands.map((b) => (
          <BrandLink
            key={b.id}
            isActive={b.slug === brandSlug}
            href={buildHref(b.slug, sort)}
          >
            {b.name}
          </BrandLink>
        ))}
      </div>

      {/* Клиентская сетка + избранное */}
      <ShopGridClient products={products} />
    </div>
  );
}

function buildHref(brandSlug: string, sort: string) {
  const params = new URLSearchParams();
  if (brandSlug) params.set("brand", brandSlug);
  if (sort && sort !== "new") params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/shop?${qs}` : "/shop";
}

function BrandLink({
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
        "px-3 py-1 rounded-full text-sm border " +
        (isActive
          ? "bg-black text-white border-black"
          : "bg-white text-gray-700 hover:bg-gray-50")
      }
    >
      {children}
    </Link>
  );
}

function SortLink({
  currentBrand,
  currentSort,
  value,
  children,
}: {
  currentBrand: string;
  currentSort: string;
  value: string;
  children: React.ReactNode;
}) {
  const href = buildHref(currentBrand, value);
  const isActive = (currentSort || "new") === value;

  return (
    <Link
      href={href}
      className={
        "px-3 py-1 rounded-full text-sm border " +
        (isActive
          ? "bg-black text-white border-black"
          : "bg-white text-gray-700 hover:bg-gray-50")
      }
    >
      {children}
    </Link>
  );
}