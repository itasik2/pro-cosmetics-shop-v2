import type { MailDeliveryResult } from "@/lib/mailer";
import { getMailConfigurationStatus } from "@/lib/mailer";
import { notifyAdminNewOrder } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

function resultError(result: MailDeliveryResult) {
  return result.status === "sent" ? null : result.reason.slice(0, 500);
}

export async function recordOrderNotificationResult(
  orderId: string,
  result: MailDeliveryResult,
) {
  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        notificationStatus:
          result.status === "sent"
            ? "SENT"
            : result.status === "skipped"
              ? "PENDING"
              : "FAILED",
        notificationAttempts: { increment: 1 },
        notificationLastError: resultError(result),
        notificationSentAt: result.status === "sent" ? new Date() : null,
      },
    });
  } catch (error) {
    console.error("ORDER NOTIFICATION STATUS UPDATE ERROR", error);
  }
}

export async function retryPendingOrderNotifications(limit = 8) {
  if (!getMailConfigurationStatus().configured) {
    return { configured: false, attempted: 0, sent: 0, failed: 0 };
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const orders = await prisma.order.findMany({
    where: {
      notificationStatus: { in: ["PENDING", "FAILED"] },
      notificationAttempts: { lt: 5 },
      createdAt: { gte: since },
    },
    include: {
      items: {
        select: { title: true, qty: true, lineTotal: true, sku: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 20),
  });

  let sent = 0;
  let failed = 0;

  for (const order of orders) {
    const result = await notifyAdminNewOrder({
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      customerName: order.customerName,
      phone: order.phone,
      customerEmail: order.email,
      deliveryType: order.deliveryType,
      address: order.address,
      comment: order.comment,
      items: order.items,
    });
    await recordOrderNotificationResult(order.id, result);

    if (result.status === "sent") {
      sent += 1;
    } else {
      failed += 1;
      if (result.status === "failed") break;
    }
  }

  return {
    configured: true,
    attempted: sent + failed,
    sent,
    failed,
  };
}
