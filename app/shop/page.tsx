
// app/shop/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ShopGridClient from "@/components/ShopGridClient";
import FavoritesButton from "@/components/FavoritesButton";
import InStockButton from "@/components/InStockButton";
import { SITE_BRAND } from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Каталог – ${SITE_BRAND}`,
  description:
    `Каталог ${SITE_BRAND}: очищающие гели, пенки, сыворотки, кремы и другие средства для ухода за кожей.`,
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

  // по умолчанию сортировки нет (""), чтобы "Новинки" могла выключаться
  const sort = (searchParams?.sort || "").trim();

  const fav = (searchParams?.fav || "").trim();
  const instock = (searchParams?.instock || "").trim();

  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true },
  });

  const selectedBrand = brandSlug ? brands.find((b) => b.slug === brandSlug) || null : null;

  // WHERE: бренд + (новинки по флагу) + (в наличии если instock=1)
  const whereBase: any = {};

  if (selectedBrand) {
    whereBase.brandId = selectedBrand.id;
  }
  
  if (sort === "new") {
    const DAYS = 14;
    const from = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  
    whereBase.OR = [
      { isNew: true },
      { createdAt: { gte: from } },
    ];
  }
  
  if (instock === "1") {
    whereBase.stock = { gt: 0 };
  }


  const orderBy =
    sort === "price_asc"
      ? [{ price: "asc" as const }, { createdAt: "desc" as const }]
      : sort === "price_desc"
      ? [{ price: "desc" as const }, { createdAt: "desc" as const }]
      : [{ createdAt: "desc" as const }];

  const products = await prisma.product.findMany({
    where: Object.keys(whereBase).length ? whereBase : undefined,
    orderBy,
    select: {
      id: true,
      name: true,
      image: true,
      price: true,
      stock: true,
      isPopular: true,
      isNew: true, // <-- ДОБАВЛЕНО
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

      <ShopGridClient products={productsForClient} />
    </div>
  );
}

function buildHref(brandSlug: string, sort: string, fav: string, instock: string) {
  const params = new URLSearchParams();
  if (brandSlug) params.set("brand", brandSlug);
  if (sort) params.set("sort", sort);
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
  const isActive = currentSort === value;

  // TOGGLE только для "new"
  const nextSort = value === "new" ? (isActive ? "" : "new") : value;

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
