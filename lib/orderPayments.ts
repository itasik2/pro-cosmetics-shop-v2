import { sendOrderMessengerNotification } from "@/lib/orderMessengerNotifications";
import { prisma } from "@/lib/prisma";

export async function cancelExpiredPrepaymentOrders(now = new Date()) {
  const expired = await prisma.order.findMany({
    where: {
      paymentMethod: "KASPI_TRANSFER",
      paymentStatus: "UNPAID",
      paymentDueAt: { lt: now },
      status: { in: ["CONFIRMED", "PACKING", "SHIPPED"] },
    },
    select: { id: true, notificationChannel: true },
  });

  if (expired.length === 0) {
    return { canceled: 0, messengerNotified: 0 };
  }

  const result = await prisma.order.updateMany({
    where: { id: { in: expired.map((order) => order.id) } },
    data: { status: "CANCELED" },
  });

  let messengerNotified = 0;
  for (const order of expired) {
    if (
      order.notificationChannel === "WHATSAPP" ||
      order.notificationChannel === "TELEGRAM"
    ) {
      const delivery = await sendOrderMessengerNotification(
        order.id,
        "STATUS_UPDATE",
      );
      if (delivery.status === "sent") messengerNotified += 1;
    }
  }

  return { canceled: result.count, messengerNotified };
}
