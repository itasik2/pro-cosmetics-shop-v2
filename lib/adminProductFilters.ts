import { adminStockSummary, adminVariants } from "./adminProductVariants";
import { isUsablePhoto } from "./enrichment/photoQuality";

export type ProductFilters = {
  publication: "all" | "draft" | "published";
  category: string;
  brand: string;
  supplier: string;
  priceImport: string;
  stock: "all" | "available" | "empty";
  content:
    | "all"
    | "no-photo"
    | "no-description"
    | "variants"
    | "no-variants"
    | "review"
    | "new"
    | "popular";
};
export const emptyProductFilters: ProductFilters = {
  publication: "all",
  category: "",
  brand: "",
  supplier: "",
  priceImport: "",
  stock: "all",
  content: "all",
};
type Product = {
  name: string;
  category: string;
  isPublished: boolean;
  stock: number;
  variants?: unknown;
  brandId: string | null;
  supplier?: { id: string } | null;
  priceSources?: { importId: string }[];
  image: string;
  description?: string | null;
  shortDescription?: string | null;
  enrichmentStatus?: string;
  isNew: boolean;
  isPopular: boolean;
};
export function productMatchesFilters(
  product: Product,
  filters: ProductFilters,
) {
  if (filters.publication === "draft" && product.isPublished) return false;
  if (filters.publication === "published" && !product.isPublished) return false;
  if (
    filters.category &&
    product.category.trim().toLocaleLowerCase("ru-RU") !== filters.category
  )
    return false;
  if (filters.brand && product.brandId !== filters.brand) return false;
  if (filters.supplier && product.supplier?.id !== filters.supplier)
    return false;
  if (
    filters.priceImport &&
    !product.priceSources?.some(
      (source) => source.importId === filters.priceImport,
    )
  )
    return false;
  const total = adminStockSummary(product).total;
  if (filters.stock === "available" && total <= 0) return false;
  if (filters.stock === "empty" && total > 0) return false;
  const variants = adminVariants(product.variants);
  switch (filters.content) {
    case "no-photo":
      return !isUsablePhoto(product.image);
    case "no-description":
      return (
        !product.shortDescription?.trim() ||
        !product.description?.trim() ||
        /^описание\s+готовится[.!]?$/iu.test(product.description.trim())
      );
    case "variants":
      return variants.length > 0;
    case "no-variants":
      return variants.length === 0;
    case "review":
      return ["REVIEW", "SOURCE_REQUIRED", "FAILED"].includes(
        product.enrichmentStatus || "",
      );
    case "new":
      return product.isNew;
    case "popular":
      return product.isPopular;
    default:
      return true;
  }
}

export function selectedVisibleProducts<T extends { id: string }>(
  products: T[],
  selectedIds: ReadonlySet<string>,
) {
  return products.filter((product) => selectedIds.has(product.id));
}
