import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { PUBLIC_PRODUCT_CARD_SELECT } from "./publicProductSelect";
import { overlayCatalogHubProducts } from "./catalogHubOverlay";
import { getCatalogHubShadowConfig } from "./catalogHubClient";
import { collapseRepresentedProductCards } from "./publicProductCards";
import { CATEGORY_OPTIONS, parseBudget, productMatchesBudget, productMatchesCare, productMatchesCategory } from "./catalogFilters";
import { productMatchesSearch } from "./productSearch";
import { catalogVariants } from "./catalogBatch";
import type { CatalogQuery, CatalogSource } from "./catalogTypes";

export const getCatalogBrands = cache(() => prisma.brand.findMany({
  where: { isActive: true, products: { some: { isPublished: true, enrichmentStatus: { not: "MERGED" } } } },
  orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true },
}));

export function firstParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] || "" : value || "").trim();
}
export function parseSlugList(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value.join(",") : value || "";
  return Array.from(new Set(raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= 200))).slice(0, 100);
}
export function parseCatalogQuery(params: Record<string, string | string[] | undefined> = {}): CatalogQuery {
  return {
    brandSlugs: parseSlugList(params.brand), categorySlugs: parseSlugList(params.category),
    sort: firstParam(params.sort) === "new" ? "new" : "", fav: firstParam(params.fav) === "1" ? "1" : "",
    instock: firstParam(params.instock) === "1" ? "1" : "", searchQuery: firstParam(params.q).slice(0, 120),
    care: firstParam(params.care).slice(0, 200), maxPrice: parseBudget(firstParam(params.maxPrice)),
  };
}

export async function getCatalogData(query: CatalogQuery) {
  const where: Prisma.ProductWhereInput = {
    isPublished: true, enrichmentStatus: { not: "MERGED" },
    ...(query.sort === "new" ? { OR: [{ isNew: true }, { createdAt: { gte: new Date(Date.now() - 14 * 86400000) } }] } : {}),
  };
  const [brands, rows] = await Promise.all([getCatalogBrands(), prisma.product.findMany({
    where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: PUBLIC_PRODUCT_CARD_SELECT,
  })]);
  const selectedBrands = brands.filter((brand) => query.brandSlugs.includes(brand.slug));
  const selectedCategories = CATEGORY_OPTIONS.filter((category) => query.categorySlugs.includes(category.slug));
  const selectedNames = new Set(selectedBrands.map((brand) => brand.name.toLocaleLowerCase("ru-RU")));
  const overlaid = await overlayCatalogHubProducts(rows);
  const products = collapseRepresentedProductCards(overlaid)
    .filter((product) => !selectedNames.size || Boolean(product.brand && selectedNames.has(product.brand.name.toLocaleLowerCase("ru-RU"))))
    .filter((product) => !selectedCategories.length || selectedCategories.some((category) => productMatchesCategory(product, category)))
    .filter((product) => productMatchesSearch(product, query.searchQuery))
    .filter((product) => productMatchesCare(product, query.care))
    .filter((product) => productMatchesBudget(product, query.maxPrice))
    .filter((product) => query.instock !== "1" || (catalogVariants(product.variants)?.some((variant) => variant.stock > 0) ?? product.stock > 0))
    .map((product) => query.maxPrice === null ? product : { ...product,
      variants: catalogVariants(product.variants)?.sort((a, b) => Number(b.stock > 0 && b.price <= query.maxPrice!) - Number(a.stock > 0 && a.price <= query.maxPrice!)) ?? null,
    });
  return { brands, selectedBrands, selectedCategories, products };
}

export async function getBrandCatalogProducts(brandName: string) {
  const rows = await prisma.product.findMany({
    where: { isPublished: true, enrichmentStatus: { not: "MERGED" },
      ...(!getCatalogHubShadowConfig().readEnabled ? { brand: { name: { equals: brandName, mode: "insensitive" as const } } } : {}),
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: PUBLIC_PRODUCT_CARD_SELECT,
  });
  const products = await overlayCatalogHubProducts(rows);
  return collapseRepresentedProductCards(products.filter((product) => product.brand?.name.toLocaleLowerCase("ru-RU") === brandName.toLocaleLowerCase("ru-RU")));
}

export async function loadCatalogProducts(source: CatalogSource) {
  if (source.kind === "catalog") return (await getCatalogData(source.query)).products;
  const brand = await prisma.brand.findUnique({ where: { slug: source.slug }, select: { name: true, isActive: true } });
  return brand?.isActive ? getBrandCatalogProducts(brand.name) : [];
}
