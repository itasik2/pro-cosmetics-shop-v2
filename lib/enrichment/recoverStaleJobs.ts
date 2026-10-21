import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Discovery is bounded to 150 seconds; retain the existing conservative lease.
export const STALE_ENRICHMENT_MS = 30 * 60 * 1000;

type RecoveryDatabase = Pick<
  Prisma.TransactionClient,
  "product" | "enrichmentJob"
>;

export async function recoverStaleEnrichmentJobs(
  database: RecoveryDatabase = prisma,
  productIds?: readonly string[],
  now = new Date(),
) {
  if (productIds && !productIds.length)
    return { expiredJobs: 0, unlockedProducts: 0 };
  const ids = productIds ? [...new Set(productIds)] : undefined;
  const staleBefore = new Date(now.getTime() - STALE_ENRICHMENT_MS);
  const expired = await database.enrichmentJob.updateMany({
    where: {
      ...(ids ? { productId: { in: ids } } : {}),
      updatedAt: { lt: staleBefore },
      OR: [
        { status: "RUNNING" },
        { status: "PENDING", scheduledAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "FAILED",
      finishedAt: now,
      error: "stale_enrichment_job_recovered",
    },
  });
  const unlocked = await database.product.updateMany({
    where: {
      ...(ids ? { id: { in: ids } } : {}),
      enrichmentStatus: "RUNNING",
      updatedAt: { lt: staleBefore },
      // A newer job or a future scheduled job still owns the product.
      enrichmentJobs: { none: { status: { in: ["PENDING", "RUNNING"] } } },
    },
    data: { enrichmentStatus: "FAILED" },
  });
  return { expiredJobs: expired.count, unlockedProducts: unlocked.count };
}
