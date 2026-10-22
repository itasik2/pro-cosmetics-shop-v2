import {
  imageGroups,
  photoSku,
  type VariantImageCandidate,
  type VariantImageSelection,
} from "./variantImages";
import { isProductPhoto, isUsablePhoto } from "./photoQuality";
import {
  photoCandidateIsCurrent,
  namePhotoKey,
  type NamePhotoProduct,
} from "./photoIdentity";

type Variant = { id: string; sku?: string; image?: string; label?: string };
type PhotoProduct = NamePhotoProduct & {
  id: string;
  supplierSku?: string | null;
  variants: Variant[];
};

export function suggestedVariantCommonPhoto(
  variants: Variant[],
  primarySku?: string | null,
) {
  const usable = variants.filter((variant) => isUsablePhoto(variant.image));
  const variant = usable.find((item) => photoSku(item.sku) === photoSku(primarySku)) || usable[0];
  return variant ? {
    url: variant.image!, variantId: variant.id,
    sku: variant.sku || "", label: variant.label || "",
  } : null;
}

export type CommonPhotoCandidate = VariantImageCandidate & {
  variantId?: string;
  sku?: string;
  label?: string;
  stored?: boolean;
};

function rankedCandidates<T extends VariantImageCandidate>(values: T[]) {
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
  if (!sku && product.variants.length) return [];
  const primaryVariant = sku
    ? product.variants.find((variant) => photoSku(variant.sku) === sku)
    : undefined;
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
      rankedCandidates(
        groups
          .flatMap((group) => group.candidates)
          .filter((candidate) =>
            photoCandidateIsCurrent(candidate, product, primaryVariant),
          ),
      ).map((candidate) => [candidate.url, candidate]),
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
  const commonCandidates = commonPhotoCandidates(product, facts);
  const variantImages: VariantImageSelection[] = product.variants.flatMap(
    (variant) => {
      if (isUsablePhoto(variant.image)) return [];
      const group = groups.find(
        (item) =>
          item.variantId === variant.id &&
          photoSku(item.sku) === photoSku(variant.sku),
      );
      const image = rankedCandidates(
        (group?.candidates || []).filter((candidate) =>
          photoCandidateIsCurrent(candidate, product, variant),
        ),
      )[0];
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

export function commonPhotoCandidates(product: PhotoProduct, facts: unknown): CommonPhotoCandidate[] {
  const data = facts && typeof facts === "object" ? facts as Record<string, unknown> : {};
  const sku = photoSku(product.supplierSku || product.variants[0]?.sku);
  const primary = product.variants.find((variant) => photoSku(variant.sku) === sku);
  const ordered = [...product.variants].sort((a, b) =>
    Number(photoSku(b.sku) === sku) - Number(photoSku(a.sku) === sku),
  );
  const stored: CommonPhotoCandidate[] = ordered.flatMap((variant) =>
    isUsablePhoto(variant.image) ? [{
      url: variant.image, source: "WEB", stored: true,
      variantId: variant.id, sku: variant.sku || "", label: variant.label,
      identityKey: namePhotoKey(product, variant),
    }] : [],
  );
  const primaryCandidates = primarySkuPhotoCandidates(product, facts).map((candidate) => ({
    ...candidate, variantId: primary?.id, sku, label: primary?.label,
  }));
  const groups = imageGroups(data.variantImageCandidates);
  const other = ordered.flatMap((variant) => groups.filter((group) =>
    group.variantId === variant.id && photoSku(group.sku) === photoSku(variant.sku),
  ).flatMap((group) => group.candidates.filter((candidate) =>
    photoCandidateIsCurrent(candidate, product, variant),
  ).map((candidate) => ({
    ...candidate, variantId: variant.id, sku: variant.sku || "", label: variant.label,
  }))));
  const values: CommonPhotoCandidate[] = [...stored, ...primaryCandidates, ...other];
  const unique = new Map<string, CommonPhotoCandidate>();
  for (const candidate of rankedCandidates(values))
    if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);
  return [...unique.values()];
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
