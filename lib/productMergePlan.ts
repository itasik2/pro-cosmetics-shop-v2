import {
  makeImportedVariant,
  normalizeStoredVariants,
  variantLabel,
  type StoredProductVariant,
} from "./price-import/productVariants";
import { photoSku } from "./enrichment/variantImages";
import { isUsablePhoto } from "./enrichment/photoQuality";

type MergeProduct = {
  id: string;
  name: string;
  supplierSku: string | null;
  variants: unknown;
  volumeValue: number | null;
  volumeUnit: string | null;
  price: number;
  stock: number;
  image: string;
};
function labelFor(product: MergeProduct) {
  return (
    variantLabel(product) ||
    product.name.match(
      /\d+(?:[.,]\d+)?\s*(?:мл|ml|кг|kg|л|l|г|g|шт\.?)(?=$|[\s,)])/iu,
    )?.[0] ||
    ""
  );
}
function volumeKey(label: string) {
  const match = label.match(/^(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|г|g|кг|kg)$/iu);
  if (!match) return label.toLocaleLowerCase("ru-RU").replace(/\s+/g, "");
  const unit = match[2].toLowerCase();
  return (
    Number(match[1].replace(",", ".")) *
      (/^(л|l|кг|kg)$/.test(unit) ? 1000 : 1) +
    (/^(г|g|кг|kg)$/.test(unit) ? "g" : "ml")
  );
}
export function productMergePlan(
  products: MergeProduct[],
  canonicalId: string,
) {
  const canonical = products.find((p) => p.id === canonicalId);
  if (!canonical || products.length < 2) throw new Error("merge_group_invalid");
  const variants: StoredProductVariant[] = [];
  const orderMappings: {
    productId: string;
    fromVariantId: string | null;
    variantId: string;
  }[] = [];
  const warnings = new Set<string>();
  const labels = new Map<string, string>();
  const samePrimarySku = products.every(
    (p) =>
      photoSku(p.supplierSku) &&
      photoSku(p.supplierSku) === photoSku(canonical.supplierSku),
  );
  for (const product of [
    canonical,
    ...products.filter((p) => p.id !== canonicalId),
  ]) {
    const stored = normalizeStoredVariants(product.variants);
    const knownSkuLabel = photoSku(product.supplierSku)
      ? products.flatMap((source) => {
          const rows = normalizeStoredVariants(source.variants);
          return rows.length
            ? rows
                .filter(
                  (row) => photoSku(row.sku) === photoSku(product.supplierSku),
                )
                .map((row) =>
                  /^\d+(?:[.,]\d+)?$/.test(row.label) && source.volumeUnit
                    ? variantLabel({
                        volumeValue: Number(row.label.replace(",", ".")),
                        volumeUnit: source.volumeUnit,
                      })
                    : row.label,
                )
            : photoSku(source.supplierSku) === photoSku(product.supplierSku) &&
                labelFor(source)
              ? [labelFor(source)]
              : [];
        })[0]
      : "";
    const label =
      labelFor(product) ||
      knownSkuLabel ||
      (samePrimarySku ? "Стандартный" : "");
    if (!stored.length && !label) throw new Error("variant_label_missing");
    const rows = stored.length
      ? stored
      : [
          makeImportedVariant({
            sku: product.supplierSku,
            label,
            price: product.price,
            stock: product.stock,
            image: isUsablePhoto(product.image) ? product.image : null,
          }),
        ];
    for (const row of rows) {
      const displayLabel =
        /^\d+(?:[.,]\d+)?$/.test(row.label) && product.volumeUnit
          ? variantLabel({
              volumeValue: Number(row.label.replace(",", ".")),
              volumeUnit: product.volumeUnit,
            })
          : row.label;
      const incoming = { ...row, label: displayLabel };
      const sku = photoSku(incoming.sku);
      const key = sku || "label:" + volumeKey(incoming.label);
      if (!sku)
        warnings.add(
          "В части карточек отсутствует SKU — проверьте объединение вручную.",
        );
      const previousSku = labels.get(volumeKey(incoming.label));
      if (previousSku && sku && previousSku !== sku)
        throw new Error("variant_volume_ambiguous");
      if (sku) labels.set(volumeKey(incoming.label), sku);
      let target = variants.find(
        (v) => (photoSku(v.sku) || "label:" + volumeKey(v.label)) === key,
      );
      if (target) {
        if (volumeKey(target.label) !== volumeKey(incoming.label))
          throw new Error("sku_volume_conflict");
        if (target.price !== incoming.price)
          warnings.add(
            "У одинакового SKU разные цены — сохраняется цена основной карточки.",
          );
        target.stock = Math.max(target.stock, incoming.stock);
        if (!isUsablePhoto(target.image) && isUsablePhoto(incoming.image))
          target.image = incoming.image;
      } else {
        target = { ...incoming };
        if (variants.some((v) => v.id === target!.id))
          target.id = makeImportedVariant(incoming).id;
        variants.push(target);
      }
      orderMappings.push({
        productId: product.id,
        fromVariantId: stored.length ? row.id : null,
        variantId: target.id,
      });
    }
    if (stored.length) {
      const primary =
        variants.find(
          (v) =>
            photoSku(v.sku) &&
            photoSku(v.sku) === photoSku(product.supplierSku),
        ) ||
        variants.find((v) =>
          orderMappings.some(
            (m) => m.productId === product.id && m.variantId === v.id,
          ),
        )!;
      orderMappings.push({
        productId: product.id,
        fromVariantId: null,
        variantId: primary.id,
      });
    }
  }
  return {
    variants,
    orderMappings,
    automatic: warnings.size === 0,
    warnings: [...warnings],
    kind:
      variants.length === 1 ? ("duplicates" as const) : ("variants" as const),
  };
}
