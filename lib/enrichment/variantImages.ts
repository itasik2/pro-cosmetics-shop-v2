// Client-safe types and identity checks shared by the editor and enrichment.
import {
  photoCandidateIsCurrent,
  type NamePhotoProduct,
} from "./photoIdentity";
export type VariantImageCandidate = {
  url: string;
  source: "WEB" | "PRICE_LIST";
  sourceUrl?: string;
  rowNumber?: number;
  identityKey?: string;
};
export type VariantImageGroup = {
  variantId: string;
  sku: string;
  candidates: VariantImageCandidate[];
};
export type VariantImageSelection = {
  variantId: string;
  sku: string;
  imageUrl: string | null;
};
export type ImageVariant = {
  id: string;
  sku?: string;
  image?: string;
  label?: string;
};

export function photoSku(value: unknown) {
  // Preserve punctuation: AV-02 and AV02 can be different supplier identifiers.
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

export function imageGroups(value: unknown): VariantImageGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const group = raw as Record<string, unknown>;
    if (
      typeof group.variantId !== "string" ||
      typeof group.sku !== "string" ||
      !Array.isArray(group.candidates)
    )
      return [];
    const candidates = group.candidates.flatMap((rawCandidate) => {
      if (!rawCandidate || typeof rawCandidate !== "object") return [];
      const candidate = rawCandidate as VariantImageCandidate;
      if (
        typeof candidate.url !== "string" ||
        !/^https?:\/\//i.test(candidate.url) ||
        !["WEB", "PRICE_LIST"].includes(candidate.source)
      )
        return [];
      return [candidate];
    });
    return [{ variantId: group.variantId, sku: group.sku, candidates }];
  });
}

export function mergeImageGroups(...sets: VariantImageGroup[][]) {
  const result = new Map<string, VariantImageGroup>();
  for (const groups of sets)
    for (const group of groups) {
      const key = group.variantId + "\n" + photoSku(group.sku);
      const previous = result.get(key);
      const candidates = [...(previous?.candidates || []), ...group.candidates];
      result.set(key, {
        ...group,
        candidates: [
          ...new Map(candidates.map((item) => [item.url, item])).values(),
        ].slice(0, 12),
      });
    }
  return [...result.values()];
}

export function validateVariantImages(
  variants: ImageVariant[],
  selections: VariantImageSelection[],
  groups: VariantImageGroup[],
  product?: NamePhotoProduct,
) {
  const seen = new Set<string>();
  for (const selection of selections) {
    const variant = variants.find((item) => item.id === selection.variantId);
    if (!variant || seen.has(selection.variantId))
      throw new Error("variant_image_target_invalid");
    seen.add(selection.variantId);
    if (
      !photoSku(selection.sku) ||
      photoSku(variant.sku) !== photoSku(selection.sku)
    )
      throw new Error("variant_sku_changed");
    if (selection.imageUrl === null) continue; // Explicitly use the common photo.
    const allowed = groups.some(
      (group) =>
        group.variantId === variant.id &&
        photoSku(group.sku) === photoSku(variant.sku) &&
        group.candidates.some(
          (candidate) =>
            candidate.url === selection.imageUrl &&
            (!candidate.identityKey ||
              (product &&
                photoCandidateIsCurrent(candidate, product, variant))),
        ),
    );
    if (!allowed) throw new Error("variant_image_not_allowed");
  }
}

export function assignVariantImages<T extends ImageVariant>(
  variants: T[],
  selections: VariantImageSelection[],
): T[] {
  // Recheck identities against the fresh row inside the write transaction.
  return variants.map((variant) => {
    const selection = selections.find((item) => item.variantId === variant.id);
    if (!selection) return variant;
    if (photoSku(variant.sku) !== photoSku(selection.sku))
      throw new Error("variant_sku_changed");
    const next = { ...variant };
    if (selection.imageUrl) next.image = selection.imageUrl;
    else delete next.image;
    return next;
  });
}

export function variantDisplayImage(
  variant: { image?: string } | null | undefined,
  commonImage: string,
) {
  return variant?.image?.trim() || commonImage;
}

export function invalidateChangedSkuImages<T extends ImageVariant>(
  current: ImageVariant[],
  incoming: T[],
): T[] {
  return incoming.map((variant) => {
    const previous = current.find((item) => item.id === variant.id);
    if (
      !previous ||
      photoSku(previous.sku) === photoSku(variant.sku) ||
      !variant.image ||
      variant.image !== previous.image
    )
      return variant;
    const next = { ...variant };
    delete next.image;
    return next;
  });
}
