import {
  normalizeStoredVariants,
  productIdentityKey,
  variantLabel,
} from "./price-import/productVariants";

type PublicProductCard = {
  id: string;
  name: string;
  supplierId?: string | null;
  volumeValue?: number | null;
  volumeUnit?: string | null;
  variants?: unknown;
  brand?: { name: string } | null;
};

function normalizeLabel(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, "")
    .trim();
}

function storedLabels(product: PublicProductCard) {
  return new Set(
    normalizeStoredVariants(product.variants)
      .map((variant) => normalizeLabel(variant.label))
      .filter(Boolean),
  );
}

function ownLabels(product: PublicProductCard) {
  const labels = storedLabels(product);
  if (labels.size) return labels;

  const label = normalizeLabel(
    variantLabel({
      volumeValue: product.volumeValue,
      volumeUnit: product.volumeUnit,
    }),
  );
  return new Set(label ? [label] : []);
}

function representativeScore(product: PublicProductCard) {
  return (
    storedLabels(product).size * 100 +
    (product.supplierId ? 10 : 0)
  );
}

/**
 * Убирает из публичной сетки только те отдельные карточки, чьи фасовки уже
 * полностью представлены вариантами другой карточки того же бренда и товара.
 * Если соответствие неполное, группа остаётся без изменений.
 */
export function collapseRepresentedProductCards<T extends PublicProductCard>(
  products: T[],
) {
  const groups = new Map<string, T[]>();

  for (const product of products) {
    const key = productIdentityKey({
      brandName: product.brand?.name,
      name: product.name,
      volumeValue: product.volumeValue,
      volumeUnit: product.volumeUnit,
    });
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(product);
    groups.set(key, group);
  }

  const hiddenIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const candidates = [...group]
      .filter((product) => storedLabels(product).size > 0)
      .sort((left, right) => representativeScore(right) - representativeScore(left));

    const representative = candidates.find((candidate) => {
      const representedLabels = storedLabels(candidate);
      return group.every((product) => {
        if (product.id === candidate.id) return true;
        const labels = ownLabels(product);
        return (
          labels.size > 0 &&
          [...labels].every((label) => representedLabels.has(label))
        );
      });
    });

    if (!representative) continue;
    for (const product of group) {
      if (product.id !== representative.id) hiddenIds.add(product.id);
    }
  }

  return products.filter((product) => !hiddenIds.has(product.id));
}
