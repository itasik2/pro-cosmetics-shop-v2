import { prisma } from "@/lib/prisma";

export async function cancelExpiredPrepaymentOrders(now = new Date()) {
  const result = await prisma.order.updateMany({
    where: {
      paymentMethod: "KASPI_TRANSFER",
      paymentStatus: "UNPAID",
      paymentDueAt: { lt: now },
      status: { in: ["CONFIRMED", "PACKING", "SHIPPED"] },
    },
    data: { status: "CANCELED" },
  });

  return { canceled: result.count };
}
