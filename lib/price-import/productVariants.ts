import { createHash } from "node:crypto";
import type { ParsedImportRow } from "./parsedRow";

export type StoredProductVariant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
  image?: string;
};

type GroupableRow = Pick<
  ParsedImportRow,
  | "brand"
  | "normalizedName"
  | "volumeLabel"
  | "volumeValue"
  | "volumeUnit"
  | "productLineCode"
  | "productLineName"
  | "category"
>;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function baseProductName(name: string, volumeLabel?: string | null) {
  let result = clean(name);
  const label = clean(volumeLabel);

  if (label) {
    const escaped = escapeRegExp(label);
    result = result.replace(
      new RegExp(`(?:\\s*[,;/\\-–—(]\\s*)?${escaped}\\s*\\)?\\s*$`, "iu"),
      "",
    );
  }

  result = result.replace(
    /(?:\s*[,;/\-–—(]\s*)?\d+(?:[.,]\d+)?\s*(?:мл|ml|л|литр(?:а|ов)?|г|гр\.?|g|кг|kg|шт\.?|pcs|ампул(?:а|ы)?|флакон(?:а|ы)?|упак(?:овка|овки)?|pack|рулон(?:а|ы)?)(?:\s*[xх×]\s*\d+)?\s*\)?\s*$/iu,
    "",
  );

  return result.replace(/[\s,;:/\-–—]+$/g, "").replace(/\s+/g, " ").trim() || clean(name);
}

export function variantLabel(input: {
  volumeLabel?: string | null;
  volumeValue?: number | null;
  volumeUnit?: string | null;
}) {
  const explicit = clean(input.volumeLabel);
  if (explicit) return explicit;
  if (input.volumeValue === null || input.volumeValue === undefined || !input.volumeUnit) {
    return "";
  }

  const unit: Record<string, string> = {
    ml: "мл",
    g: "г",
    pcs: "шт.",
    pack: "упак.",
    roll: "рулон",
  };

  return `${input.volumeValue} ${unit[input.volumeUnit] || input.volumeUnit}`;
}

export function parsedProductGroupKey(row: GroupableRow) {
  const label = variantLabel(row);
  if (!label) return null;

  const line = row.productLineCode || row.productLineName || row.category;
  const name = baseProductName(row.normalizedName, row.volumeLabel);
  const normalizedName = normalize(name);
  if (!normalizedName) return null;

  return [normalize(row.brand), normalize(line), normalizedName].join("|");
}

export function existingProductGroupKey(input: {
  brandName?: string | null;
  name: string;
  category?: string | null;
  productLineCode?: string | null;
  productLineName?: string | null;
  volumeValue?: number | null;
  volumeUnit?: string | null;
}) {
  if (!input.brandName) return null;
  const line = input.productLineCode || input.productLineName || input.category || "";
  const label = variantLabel({
    volumeValue: input.volumeValue,
    volumeUnit: input.volumeUnit,
  });
  const name = baseProductName(input.name, label);
  const normalizedName = normalize(name);
  if (!normalizedName) return null;
  return [normalize(input.brandName), normalize(line), normalizedName].join("|");
}

export function autoVariantGroupKeys(rows: GroupableRow[]) {
  const groups = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = parsedProductGroupKey(row);
    const label = normalize(variantLabel(row));
    if (!key || !label) continue;
    const labels = groups.get(key) ?? new Set<string>();
    labels.add(label);
    groups.set(key, labels);
  }

  return new Set(
    [...groups.entries()]
      .filter(([, labels]) => labels.size >= 2)
      .map(([key]) => key),
  );
}

export function normalizeStoredVariants(value: unknown): StoredProductVariant[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((raw) => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const id = clean(row.id);
      const label = clean(row.label);
      const price = Math.max(0, Math.trunc(Number(row.price) || 0));
      const stock = Math.max(0, Math.trunc(Number(row.stock) || 0));
      const sku = clean(row.sku);
      const image = clean(row.image);
      return {
        id,
        label,
        price,
        stock,
        ...(sku ? { sku } : {}),
        ...(image ? { image } : {}),
      };
    })
    .filter((row) => row.id && row.label);
}

export function stableVariantId(input: { sku?: string | null; label: string }) {
  const source = `${clean(input.sku).toUpperCase()}|${normalize(input.label)}`;
  return `pv-${createHash("sha1").update(source).digest("hex").slice(0, 12)}`;
}

export function makeImportedVariant(input: {
  sku?: string | null;
  label: string;
  price: number;
  stock?: number;
  image?: string | null;
}): StoredProductVariant {
  const sku = clean(input.sku);
  const image = clean(input.image);
  return {
    id: stableVariantId({ sku, label: input.label }),
    label: clean(input.label),
    price: Math.max(0, Math.trunc(input.price)),
    stock: Math.max(0, Math.trunc(input.stock ?? 0)),
    ...(sku ? { sku } : {}),
    ...(image ? { image } : {}),
  };
}

export function findVariantBySku(variants: StoredProductVariant[], sku: string | null | undefined) {
  const wanted = clean(sku).toUpperCase();
  if (!wanted) return null;
  return variants.find((variant) => clean(variant.sku).toUpperCase() === wanted) ?? null;
}

export function mergeImportedVariant(
  variants: StoredProductVariant[],
  incoming: StoredProductVariant,
) {
  const sku = clean(incoming.sku).toUpperCase();
  const label = normalize(incoming.label);
  const index = variants.findIndex((variant) => {
    const variantSku = clean(variant.sku).toUpperCase();
    if (sku && variantSku) return sku === variantSku;
    return normalize(variant.label) === label;
  });

  if (index < 0) return [...variants, incoming];

  const current = variants[index];
  const next = [...variants];
  next[index] = {
    ...current,
    ...incoming,
    id: current.id || incoming.id,
    stock: current.stock,
    ...(incoming.image || current.image ? { image: incoming.image || current.image } : {}),
  };
  return next;
}
