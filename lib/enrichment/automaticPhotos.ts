import {
  imageGroups,
  photoSku,
  type VariantImageCandidate,
  type VariantImageSelection,
} from "./variantImages";
import { isProductPhoto, isUsablePhoto } from "./photoQuality";

type Variant = { id: string; sku?: string; image?: string };
type PhotoProduct = {
  id: string;
  supplierSku?: string | null;
  variants: Variant[];
};

function rankedCandidates(values: VariantImageCandidate[]) {
  return values
    .filter((item) => isProductPhoto(item.url))
    .sort(
      (a, b) =>
        Number(a.source === "PRICE_LIST") - Number(b.source === "PRICE_LIST"),
    );
}

export function primarySkuPhotoCandidates(
  product: PhotoProduct,
  facts: unknown,
) {
  const data =
    facts && typeof facts === "object"
      ? (facts as Record<string, unknown>)
      : {};
  const sku = photoSku(product.supplierSku || product.variants[0]?.sku);
  if (!sku) return [];
  const groups = [
    ...imageGroups(data.productImageCandidates).filter(
      (group) => group.variantId === "product:" + product.id,
    ),
    ...imageGroups(data.variantImageCandidates).filter((group) =>
      product.variants.some(
        (variant) =>
          variant.id === group.variantId &&
          photoSku(variant.sku) === photoSku(group.sku),
      ),
    ),
  ].filter((group) => photoSku(group.sku) === sku);
  return [
    ...new Map(
      rankedCandidates(groups.flatMap((group) => group.candidates)).map(
        (candidate) => [candidate.url, candidate],
      ),
    ).values(),
  ];
}

export function automaticPhotoPlan(
  product: PhotoProduct & {
    image: string;
  },
  facts: unknown,
) {
  const data =
    facts && typeof facts === "object"
      ? (facts as Record<string, unknown>)
      : {};
  const groups = imageGroups(data.variantImageCandidates);
  const commonCandidates = primarySkuPhotoCandidates(product, facts);
  const variantImages: VariantImageSelection[] = product.variants.flatMap(
    (variant) => {
      if (isUsablePhoto(variant.image)) return [];
      const group = groups.find(
        (item) =>
          item.variantId === variant.id &&
          photoSku(item.sku) === photoSku(variant.sku),
      );
      const image = rankedCandidates(group?.candidates || [])[0];
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
