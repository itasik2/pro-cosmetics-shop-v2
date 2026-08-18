import { prisma } from "@/lib/prisma";

const ORDER_ARCHIVE_AGE_DAYS = 30;

export async function archiveOldOrders(now = new Date()) {
  const cutoff = new Date(
    now.getTime() - ORDER_ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000,
  );

  const result = await prisma.order.updateMany({
    where: {
      archivedAt: null,
      createdAt: { lt: cutoff },
    },
    data: {
      archivedAt: now,
    },
  });

  return {
    archived: result.count,
    cutoff: cutoff.toISOString(),
    ageDays: ORDER_ARCHIVE_AGE_DAYS,
  };
}
