import { photoSku } from "./variantImages";

export function hasManualVariantChanges(facts: unknown) {
  return Boolean(
    facts &&
    typeof facts === "object" &&
    !Array.isArray(facts) &&
    (facts as Record<string, unknown>).manualVariantReviewRequired,
  );
}

export function removedVariantSkus(facts: unknown) {
  const values =
    facts && typeof facts === "object" && !Array.isArray(facts)
      ? (facts as Record<string, unknown>).removedVariantSkus
      : [];
  return Array.isArray(values)
    ? values
        .filter((value): value is string => typeof value === "string")
        .map(photoSku)
        .filter(Boolean)
    : [];
}

export function shouldSkipRemovedVariant(
  sku: string,
  excluded: Set<string>,
  activeSkus: Set<string>,
) {
  const key = photoSku(sku);
  // Restoring a variant explicitly in the product editor overrides its old exclusion.
  return excluded.has(key) && !activeSkus.has(key);
}
