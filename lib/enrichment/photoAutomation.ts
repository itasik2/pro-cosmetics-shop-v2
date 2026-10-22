import { namePhotoKey, photoCandidateIsCurrent, type NamePhotoProduct } from "./photoIdentity";
import { imageGroups, photoSku, type ImageVariant } from "./variantImages";
import { isProductPhoto, isUsablePhoto } from "./photoQuality";

export const PHOTO_AUTOMATION_VERSION = 8;
export const VARIANT_PHOTO_BUDGET_MS = 140_000;

export type PhotoSearchProduct = NamePhotoProduct & {
  id: string;
  image: string;
  supplierSku?: string | null;
  variants: ImageVariant[];
};
export type PhotoSearchAttempt = { key: string; retryAt: string };

export function photoTargetKey(product: PhotoSearchProduct, target: ImageVariant) {
  return JSON.stringify([target.id, photoSku(target.sku), namePhotoKey(product, target)]);
}

export function photoSearchAttempts(value: unknown): PhotoSearchAttempt[] {
  const data = value as { version?: number; attempts?: PhotoSearchAttempt[] } | null;
  return data?.version === PHOTO_AUTOMATION_VERSION && Array.isArray(data.attempts)
    ? data.attempts.filter((item) => typeof item?.key === "string" && typeof item.retryAt === "string")
    : [];
}

/** The common photo never counts as a variant's own SKU photo. */
export function pendingPhotoTargets(product: PhotoSearchProduct, facts: unknown, now = Date.now()) {
  const data = (facts || {}) as Record<string, unknown>;
  const groups = [...imageGroups(data.variantImageCandidates), ...imageGroups(data.productImageCandidates)];
  const primarySku = product.supplierSku || product.variants[0]?.sku;
  const targets: ImageVariant[] = [
    ...product.variants.filter((variant) => !isUsablePhoto(variant.image)),
    ...(!isUsablePhoto(product.image) && (!product.variants.length || primarySku) &&
      !product.variants.some((variant) => photoSku(variant.sku) === photoSku(primarySku))
      ? [{ id: "product:" + product.id, sku: primarySku || "", label:
          product.volumeValue && product.volumeUnit ? `${product.volumeValue} ${product.volumeUnit}` : "" }]
      : []),
  ];
  const attempts = photoSearchAttempts(data.photoAutomation);
  return targets.filter((target) =>
    (target.sku || (target.id === "product:" + product.id && product.brand?.name)) &&
    !groups.some((group) => group.variantId === target.id && photoSku(group.sku) === photoSku(target.sku) &&
      group.candidates.some((candidate) => candidate.source === "WEB" && isProductPhoto(candidate.url) &&
        photoCandidateIsCurrent(candidate, product, target))) &&
    !attempts.some((attempt) => attempt.key === photoTargetKey(product, target) && Date.parse(attempt.retryAt) > now),
  );
}
