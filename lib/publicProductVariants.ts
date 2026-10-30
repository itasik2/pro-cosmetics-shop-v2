export type PublicProductVariant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku?: string;
  image?: string;
};

export function normalizePublicProductVariants(value: unknown): PublicProductVariant[] {
  if (!Array.isArray(value)) return [];

  const variants: PublicProductVariant[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const price = Number(raw.price);
    const stock = Number(raw.stock);
    if (!id || !label || !Number.isFinite(price) || !Number.isFinite(stock)) continue;
    variants.push({
      id,
      label,
      price: Math.max(0, Math.trunc(price)),
      stock: Math.max(0, Math.trunc(stock)),
      sku: typeof raw.sku === "string" ? raw.sku : undefined,
      image: typeof raw.image === "string" ? raw.image : undefined,
    });
  }
  return variants;
}

export function defaultPublicProductVariant(variants: PublicProductVariant[]) {
  return variants.find((variant) => variant.stock > 0) ?? variants[0] ?? null;
}

export function isRecentlyCreated(createdAt: Date | string, days = 14) {
  const date = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const time = date.getTime();
  if (!Number.isFinite(time)) return false;
  const diff = Date.now() - time;
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}
