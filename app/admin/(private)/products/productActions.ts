import type {
  ProductAction,
  ProductActionResult,
} from "@/lib/adminProductActions";

export async function requestProductActions(
  action: ProductAction,
  products: { id: string; name: string }[],
  onProgress: (done: number) => void,
): Promise<ProductActionResult> {
  const result: ProductActionResult = { processedIds: [], failures: [] };
  for (let start = 0; start < products.length; start += 50) {
    const batch = products.slice(start, start + 50);
    try {
      const response = await fetch("/api/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ids: batch.map((product) => product.id),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (
        !response.ok ||
        !Array.isArray(data.processedIds) ||
        !Array.isArray(data.failures)
      )
        throw new Error(
          data.message ||
            "Не удалось получить результат. Обновите список перед повтором.",
        );
      result.processedIds.push(...data.processedIds);
      result.failures.push(...data.failures);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Ошибка соединения. Обновите список.";
      result.failures.push(
        ...products.slice(start).map((product) => ({ ...product, message })),
      );
      break;
    }
    onProgress(Math.min(start + batch.length, products.length));
  }
  return result;
}
