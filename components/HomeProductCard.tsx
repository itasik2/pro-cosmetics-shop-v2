"use client";
import Link from "next/link";
import type { ProductCardProps } from "./ProductCard";
import { variantDisplayImage } from "@/lib/enrichment/variantImages";
import { brandNameToSlug } from "@/lib/brandSlug";
import { publicProductCategory } from "@/lib/catalogFilters";
import { publicShortDescription } from "@/lib/productCopy";
import { productDisplayName } from "@/lib/productNames";
import { useSiteLocale, useUiText } from "@/components/LocaleProvider";
import { localizedHref, categoryLabel } from "@/lib/i18n";
import ResilientProductImage from "@/components/ResilientProductImage";
import { defaultPublicProductVariant, isRecentlyCreated, normalizePublicProductVariants } from "@/lib/publicProductVariants";

const IMAGE_SIZES = "(min-width: 1152px) 318px, (min-width: 768px) calc((100vw - 198px) / 3), (min-width: 640px) calc((100vw - 140px) / 2), calc(100vw - 66px)";

/** Server-rendered card keeps product links and photos available before its controls load. */
export default function HomeProductCard({ product }: { product: ProductCardProps["product"] }) {
  const locale = useSiteLocale();
  const t = useUiText();
  const displayName = productDisplayName(product);
  const variants = normalizePublicProductVariants(product.variants);
  const selectedVariant = defaultPublicProductVariant(variants);
  const price = Number(selectedVariant?.price ?? product.price) || 0;
  const stock = Math.trunc(Number(selectedVariant?.stock ?? product.stock) || 0);
  const image = variantDisplayImage(selectedVariant, product.image);
  const href = product.slug
    ? localizedHref(`/shop/${encodeURIComponent(product.slug)}`, locale)
    : `/api/products/by-id-redirect/${encodeURIComponent(product.id)}`;
  const brandHref = product.brand
    ? `/brand/${encodeURIComponent(brandNameToSlug(product.brand.name))}`
    : null;

  return (
    <article className="card relative h-full flex flex-col transition-shadow duration-200 hover:shadow-md"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 620px" }}>
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-2">
        {product.isPopular && <span className="inline-flex items-center rounded-full bg-gray-700 px-2 py-1 text-xs text-white shadow-sm">{t("Хит")}</span>}
        {(product.isNew === true || isRecentlyCreated(product.createdAt)) && (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 shadow-sm">{t("Новинка")}</span>
        )}
        {stock <= 0 && <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-1 text-xs text-gray-700">{t("Нет в наличии")}</span>}
      </div>

      <Link href={href} prefetch={false} className="block aspect-square w-full bg-white rounded-xl mb-3 overflow-hidden" aria-label={`Открыть товар: ${displayName}`}>
        <ResilientProductImage src={image} sizes={IMAGE_SIZES} alt={displayName} />
      </Link>

      <div className="text-sm text-gray-500">
        {product.brand && brandHref ? (
          <Link href={brandHref} prefetch={false} className="hover:underline">{product.brand.name}</Link>
        ) : categoryLabel(locale, publicProductCategory(product))}
      </div>
      <h3 className="font-semibold line-clamp-2 min-h-[40px]">{displayName}</h3>
      <p className="mt-1 min-h-[40px] line-clamp-2 text-xs leading-5 text-gray-600">
        {publicShortDescription(product.shortDescription) || t("Подробное описание и способ применения — в карточке товара.")}
      </p>

      <div className="mt-2 min-h-[36px]">
        {variants.length > 0 && <div className="flex flex-wrap gap-2">
          {variants.map((variant) => (
            <span key={variant.id} className={"px-3 py-1 rounded-full text-xs border shadow-sm " +
              (variant.id === selectedVariant?.id ? "border-gray-400 bg-gray-200 text-gray-900" : "border-gray-200 bg-gray-50 text-gray-700") +
              (variant.stock <= 0 ? " opacity-60" : "")}>
              {variant.label}{variant.stock <= 0 ? ` · ${t("Нет в наличии")}` : ""}
            </span>
          ))}
        </div>}
      </div>

      <div className="mt-auto">
        <div className="mt-2 flex min-h-8 items-center justify-between gap-2">
          <div className="min-w-0 font-semibold">{price.toLocaleString("ru-RU")} ₸</div>
          <Link href={href} prefetch={false}
            className="btn h-8 min-h-8 w-[124px] shrink-0 rounded-full px-3 py-1 text-xs text-center">
            {t("Подробнее")}
          </Link>
        </div>
        <div className={"mt-1 text-xs " + (stock > 0 ? "text-emerald-700" : "text-gray-500")}>
          {stock > 0 ? `${t("В наличии:")} ${stock}` : t("Нет в наличии")}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <Link href={href} prefetch={false} className="text-xs text-gray-600 hover:underline">{t("Подробнее")}</Link>
          {stock <= 0 && product.slug && (
            <Link href={`${href}#stock-alert`} prefetch={false} className="text-xs font-semibold text-amber-800 hover:underline">
              {t("Уведомить о поступлении")}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
