import type { MailDeliveryResult } from "@/lib/mailer";
import { getMailConfigurationStatus } from "@/lib/mailer";
import {
  notifyAdminNewOrder,
  notifyCustomerOrderCreated,
  notifyCustomerPaymentRequired,
} from "@/lib/notify";
import { createOrderAccessToken, orderAccessUrl } from "@/lib/orderAccess";
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

export async function recordCustomerNotificationResult(
  orderId: string,
  result: MailDeliveryResult,
) {
  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        customerNotificationStatus:
          result.status === "sent"
            ? "SENT"
            : result.status === "skipped"
              ? "PENDING"
              : "FAILED",
        customerNotificationAttempts: { increment: 1 },
        customerNotificationLastError: resultError(result),
        customerNotificationSentAt:
          result.status === "sent" ? new Date() : null,
      },
    });
  } catch (error) {
    console.error("CUSTOMER NOTIFICATION STATUS UPDATE ERROR", error);
  }
}

export async function recordPaymentNotificationResult(
  orderId: string,
  result: MailDeliveryResult,
) {
  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentNotificationStatus:
          result.status === "sent"
            ? "SENT"
            : result.status === "skipped"
              ? "PENDING"
              : "FAILED",
        paymentNotificationAttempts: { increment: 1 },
        paymentNotificationLastError: resultError(result),
        paymentNotificationSentAt:
          result.status === "sent" ? new Date() : null,
      },
    });
  } catch (error) {
    console.error("PAYMENT NOTIFICATION STATUS UPDATE ERROR", error);
  }
}

export async function retryPendingOrderNotifications(limit = 8) {
  if (!getMailConfigurationStatus().configured) {
    return { configured: false, attempted: 0, sent: 0, failed: 0 };
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: since },
      OR: [
        {
          notificationStatus: { in: ["PENDING", "FAILED"] },
          notificationAttempts: { lt: 5 },
        },
        {
          email: { not: null },
          customerNotificationStatus: { in: ["PENDING", "FAILED"] },
          customerNotificationAttempts: { lt: 5 },
        },
        {
          email: { not: null },
          paymentMethod: "KASPI_TRANSFER",
          status: "CONFIRMED",
          paymentStatus: { in: ["UNPAID", "PENDING"] },
          paymentDueAt: { gt: now },
          paymentNotificationStatus: { in: ["PENDING", "FAILED"] },
          paymentNotificationAttempts: { lt: 5 },
        },
      ],
    },
    include: {
      items: {
        select: { title: true, qty: true, lineTotal: true, sku: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 20),
  });

  let attempted = 0;
  let sent = 0;
  let failed = 0;

  for (const order of orders) {
    const access = orderAccessUrl(createOrderAccessToken(order.orderNumber).token);

    if (
      ["PENDING", "FAILED"].includes(order.notificationStatus) &&
      order.notificationAttempts < 5
    ) {
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
        paymentMethod: order.paymentMethod,
        items: order.items,
      });
      await recordOrderNotificationResult(order.id, result);
      attempted += 1;
      if (result.status === "sent") sent += 1;
      if (result.status === "failed") {
        failed += 1;
        break;
      }
    }

    if (
      order.email &&
      ["PENDING", "FAILED"].includes(order.customerNotificationStatus) &&
      order.customerNotificationAttempts < 5
    ) {
      const result = await notifyCustomerOrderCreated({
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        customerName: order.customerName,
        phone: order.phone,
        customerEmail: order.email,
        deliveryType: order.deliveryType,
        address: order.address,
        comment: order.comment,
        paymentMethod: order.paymentMethod,
        items: order.items,
        orderAccessUrl: access,
      });
      await recordCustomerNotificationResult(order.id, result);
      attempted += 1;
      if (result.status === "sent") sent += 1;
      if (result.status === "failed") {
        failed += 1;
        break;
      }
    }

    if (
      order.email &&
      order.paymentMethod === "KASPI_TRANSFER" &&
      order.status === "CONFIRMED" &&
      ["UNPAID", "PENDING"].includes(order.paymentStatus) &&
      order.paymentDueAt &&
      order.paymentDueAt > now &&
      ["PENDING", "FAILED"].includes(order.paymentNotificationStatus) &&
      order.paymentNotificationAttempts < 5
    ) {
      const result = await notifyCustomerPaymentRequired({
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        customerName: order.customerName,
        phone: order.phone,
        customerEmail: order.email,
        deliveryType: order.deliveryType,
        address: order.address,
        comment: order.comment,
        paymentMethod: order.paymentMethod,
        items: order.items,
        paymentDueAt: order.paymentDueAt,
      });
      await recordPaymentNotificationResult(order.id, result);
      attempted += 1;
      if (result.status === "sent") sent += 1;
      if (result.status === "failed") {
        failed += 1;
        break;
      }
    }
  }

  return { configured: true, attempted, sent, failed };
}
