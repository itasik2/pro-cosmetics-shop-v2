import {
  imageGroups,
  photoSku,
  type VariantImageSelection,
} from "./variantImages";
import { isProductPhoto, isUsablePhoto } from "./photoQuality";

type Variant = { id: string; sku?: string; image?: string };
export function automaticPhotoPlan(
  product: {
    image: string;
    supplierSku?: string | null;
    variants: Variant[];
  },
  facts: unknown,
) {
  const data =
    facts && typeof facts === "object"
      ? (facts as Record<string, unknown>)
      : {};
  const groups = imageGroups(data.variantImageCandidates);
  const primary = imageGroups(data.productImageCandidates);
  const candidates = (values: (typeof groups)[number]["candidates"]) =>
    values
      .filter((item) => isProductPhoto(item.url))
      .sort(
        (a, b) =>
          Number(a.source === "PRICE_LIST") - Number(b.source === "PRICE_LIST"),
      );
  const sku = photoSku(product.supplierSku || product.variants[0]?.sku);
  const commonCandidates = [
    ...new Map(
      candidates(
        [...primary, ...groups]
          .filter((group) => sku && photoSku(group.sku) === sku)
          .flatMap((group) => group.candidates),
      ).map((item) => [item.url, item]),
    ).values(),
  ];
  const variantImages: VariantImageSelection[] = product.variants.flatMap(
    (variant) => {
      if (isUsablePhoto(variant.image)) return [];
      const group = groups.find(
        (item) =>
          item.variantId === variant.id &&
          photoSku(item.sku) === photoSku(variant.sku),
      );
      const image = candidates(group?.candidates || [])[0];
      return image && variant.sku
        ? [{ variantId: variant.id, sku: variant.sku, imageUrl: image.url }]
        : [];
    },
  );
  return {
    imageUrl: isUsablePhoto(product.image)
      ? null
      : commonCandidates[0]?.url || null,
    commonCandidates,
    variantImages,
  };
}

export function mergeAutomaticSelections(
  automatic: VariantImageSelection[],
  current: VariantImageSelection[],
  variants: Variant[],
) {
  return [
    ...new Map(
      [...automatic, ...current]
        .filter((selection) =>
          variants.some(
            (variant) =>
              variant.id === selection.variantId &&
              photoSku(variant.sku) === photoSku(selection.sku),
          ),
        )
        .map((selection) => [selection.variantId, selection]),
    ).values(),
  ];
}
