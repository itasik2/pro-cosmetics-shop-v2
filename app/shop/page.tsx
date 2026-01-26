// app/shop/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ShopGridClient from "@/components/ShopGridClient";
import FavoritesButton from "@/components/FavoritesButton";
import InStockButton from "@/components/InStockButton";

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
    fav?: string;
    instock?: string;
  };
};

// Тип варианта для клиента
type Variant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
};

// Нормализатор Prisma JsonValue -> Variant[] | null
function toVariants(v: unknown): Variant[] | null {
  if (!Array.isArray(v)) return null;

  const out: Variant[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;

    const obj = item as any;

    const id = typeof obj.id === "string" ? obj.id : null;
    const label = typeof obj.label === "string" ? obj.label : null;

    const price = typeof obj.price === "number" ? obj.price : Number(obj.price);
    const stock = typeof obj.stock === "number" ? obj.stock : Number(obj.stock);

    if (!id || !label) continue;
    if (!Number.isFinite(price) || !Number.isFinite(stock)) continue;

    out.push({
      id,
      label,
      price: Math.max(0, Math.trunc(price)),
      stock: Math.max(0, Math.trunc(stock)),
      sku: typeof obj.sku === "string" ? obj.sku : undefined,
    });
  }

  return out.length ? out : null;
}

export default async function ShopPage({ searchParams }: Props) {
  const brandSlug = (searchParams?.brand || "").trim();

  // ВАЖНО: по умолчанию сортировки нет (""), чтобы "Новинки" могла выключаться
  const sort = (searchParams?.sort || "").trim();

  const fav = (searchParams?.fav || "").trim(); // "1" или ""
  const instock = (searchParams?.instock || "").trim();

  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true },
  });

  const selectedBrand = brandSlug ? brands.find((b) => b.slug === brandSlug) || null : null;

  const orderBy =
    sort === "price_asc"
      ? [{ price: "asc" as const }, { createdAt: "desc" as const }]
      : sort === "price_desc"
      ? [{ price: "desc" as const }, { createdAt: "desc" as const }]
      : [{ createdAt: "desc" as const }]; // дефолтный порядок (как был)

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
      variants: true,
    },
  });

  const productsForClient = products.map((p) => ({
    ...p,
    variants: toVariants((p as any).variants),
  }));

  return (
    <div className="space-y-6 py-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Каталог</h2>
          <div className="text-sm text-gray-500 mt-1">
            {selectedBrand ? `Бренд: ${selectedBrand.name}` : "Все бренды"} •{" "}
            {productsForClient.length} поз.
          </div>
        </div>

        {/* Сортировка + Избранное */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <SortLink
            currentBrand={brandSlug}
            currentSort={sort}
            currentFav={fav}
            currentInStock={instock}
            value="new"
          >
            Новинки
          </SortLink>

          <SortLink
            currentBrand={brandSlug}
            currentSort={sort}
            currentFav={fav}
            currentInStock={instock}
            value="price_asc"
          >
            Цена ↑
          </SortLink>

          <SortLink
            currentBrand={brandSlug}
            currentSort={sort}
            currentFav={fav}
            currentInStock={instock}
            value="price_desc"
          >
            Цена ↓
          </SortLink>

          <InStockButton />
          <FavoritesButton />
        </div>
      </div>

      {/* Фильтр по бренду */}
      <div className="flex flex-wrap gap-2">
        <BrandLink isActive={!brandSlug} href={buildHref("", sort, fav, instock)}>
          Все
        </BrandLink>

        {brands.map((b) => (
          <BrandLink
            key={b.id}
            isActive={b.slug === brandSlug}
            href={buildHref(b.slug, sort, fav, instock)}
          >
            {b.name}
          </BrandLink>
        ))}
      </div>

      {/* Клиентская сетка */}
      <ShopGridClient products={productsForClient} />
    </div>
  );
}

function buildHref(brandSlug: string, sort: string, fav: string, instock: string) {
  const params = new URLSearchParams();
  if (brandSlug) params.set("brand", brandSlug);

  // "new" и "" не пишем в URL, чтобы "Новинки" могла выключаться
  if (sort && sort !== "new") params.set("sort", sort);

  if (fav === "1") params.set("fav", "1");
  if (instock === "1") params.set("instock", "1");

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
  currentFav,
  currentInStock,
  value,
  children,
}: {
  currentBrand: string;
  currentSort: string;
  currentFav: string;
  currentInStock: string;
  value: string;
  children: React.ReactNode;
}) {
  const isActive =
    value === "new" ? (currentSort || "") === "new" : (currentSort || "") === value;

  // TOGGLE: если уже "new", то сбрасываем (href без sort)
  const nextSort =
    value === "new"
      ? isActive
        ? "" // сброс фильтра
        : "new"
      : value;

  const href = buildHref(currentBrand, nextSort, currentFav, currentInStock);

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
