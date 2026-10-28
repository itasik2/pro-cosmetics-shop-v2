import type { CatalogBatch, CatalogBatchRequest, CatalogCard } from "./catalogTypes";

export async function requestCatalogBatch(input: CatalogBatchRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<CatalogBatch> {
  const response = await fetcher("/api/catalog/products", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal, body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !Array.isArray(data.products) || !Number.isInteger(data.total) ||
    typeof data.hasMore !== "boolean" || (data.hasMore && (!data.cursor || typeof data.cursor.id !== "string" || !Number.isFinite(Date.parse(data.cursor.createdAt))))) {
    throw new Error("Не удалось загрузить товары. Попробуйте ещё раз.");
  }
  return data as CatalogBatch;
}

export function mergeCatalogProducts(current: CatalogCard[], incoming: CatalogCard[]) {
  const merged = new Map(current.map((product) => [product.id, product]));
  for (const product of incoming) merged.set(product.id, product);
  return [...merged.values()];
}
