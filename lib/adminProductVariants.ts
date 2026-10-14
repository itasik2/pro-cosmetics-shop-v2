export type AdminVariant = {
  id: string;
  label: string;
  price: number;
  stock: number;
  sku: string;
  image: string;
};

function quantity(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function adminVariants(value: unknown): AdminVariant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const id = String(row.id || "").trim();
    const label = String(row.label || "").trim();
    if (!id || !label) return [];
    return [
      {
        id,
        label,
        price: quantity(row.price),
        stock: quantity(row.stock),
        sku: String(row.sku || ""),
        image: String(row.image || ""),
      },
    ];
  });
}

export function adminStockSummary(product: {
  variants?: unknown;
  stock: number;
}) {
  const variants = adminVariants(product.variants);
  return {
    variants,
    total: variants.length
      ? variants.reduce((sum, row) => sum + row.stock, 0)
      : quantity(product.stock),
    available: variants.filter((row) => row.stock > 0).length,
  };
}

// Send only edited quantities: opening a row must not overwrite other stock updates.
export function variantStockChanges(
  variants: AdminVariant[],
  draft: Record<string, string>,
) {
  return variants.flatMap((variant) => {
    const value = draft[variant.id];
    if (value === undefined || value === String(variant.stock)) return [];
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > 1_000_000
    ) {
      throw new Error(
        `Укажите целое количество от 0 до 1 000 000 для «${variant.label}».`,
      );
    }
    const stock = Number(value);
    return stock === variant.stock ? [] : [{ variantId: variant.id, stock }];
  });
}
