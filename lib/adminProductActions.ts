import { z } from "zod";
import { prisma } from "./prisma";
import { recoverStaleEnrichmentJobs } from "./enrichment/recoverStaleJobs";

export const productActionSchema = z
  .object({
    action: z.enum(["unpublish", "delete"]),
    ids: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(100)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();

export type ProductAction = "unpublish" | "delete";
export type ProductActionResult = {
  processedIds: string[];
  failures: { id: string; name: string; message: string }[];
};

class ProductActionError extends Error {}

export async function applyProductActions(
  input: z.infer<typeof productActionSchema>,
  database = prisma,
): Promise<ProductActionResult> {
  const result: ProductActionResult = { processedIds: [], failures: [] };
  const deadline = Date.now() + 40_000;
  for (const [index, id] of input.ids.entries()) {
    if (Date.now() >= deadline) {
      result.failures.push(
        ...input.ids.slice(index).map((remainingId) => ({
          id: remainingId,
          name: remainingId,
          message: "Не обработан за время этой группы. Повторите действие.",
        })),
      );
      break;
    }
    let name = id;
    try {
      await database.$transaction(
        async (tx) => {
          await recoverStaleEnrichmentJobs(tx, [id]);
          const product = await tx.product.findUnique({
            where: { id },
            select: {
              id: true,
              name: true,
              updatedAt: true,
              enrichmentStatus: true,
            },
          });
          if (!product)
            throw new ProductActionError(
              "Товар уже удалён или не найден. Обновите список.",
            );
          name = product.name;
          if (product.enrichmentStatus === "MERGED")
            throw new ProductActionError(
              "Товар уже объединён с другой карточкой. Обновите список.",
            );
          const activeJob = await tx.enrichmentJob.findFirst({
            where: { productId: id, status: { in: ["PENDING", "RUNNING"] } },
            select: { id: true },
          });
          if (activeJob || product.enrichmentStatus === "RUNNING")
            throw new ProductActionError(
              "Выполняется поиск ИИ. Дождитесь завершения и повторите действие.",
            );
          const where = {
            id,
            updatedAt: product.updatedAt,
            enrichmentStatus: { not: "MERGED" },
          };
          const written =
            input.action === "delete"
              ? await tx.product.deleteMany({ where })
              : await tx.product.updateMany({
                  where,
                  data: { isPublished: false },
                });
          if (written.count !== 1)
            throw new ProductActionError(
              "Товар изменился. Обновите список и повторите действие.",
            );
        },
        { isolationLevel: "Serializable", timeout: 5000 },
      );
      result.processedIds.push(id);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const message =
        code === "P2003"
          ? "Товар связан с другими данными. Снимите его с публикации."
          : code === "P2034"
            ? "Товар изменился. Обновите список и повторите действие."
            : error instanceof ProductActionError
              ? error.message
              : "Не удалось выполнить действие. Повторите попытку.";
      result.failures.push({ id, name, message });
    }
  }
  return result;
}
