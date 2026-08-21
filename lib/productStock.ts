export function variantStockTotal(value: unknown): number | null {
  if (!Array.isArray(value)) return null;

  const variants = value.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && String((row as Record<string, unknown>).label || "").trim().length > 0,
  );

  if (variants.length === 0) return null;

  return variants.reduce((sum, variant) => {
    const stock = Math.max(0, Math.trunc(Number(variant.stock) || 0));
    return sum + stock;
  }, 0);
}
