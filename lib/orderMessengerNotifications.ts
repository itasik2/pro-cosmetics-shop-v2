import {
  type MessengerDeliveryResult,
  type MessengerEvent,
  sendCustomerMessengerNotification,
} from "@/lib/messenger";
import { createOrderAccessToken, orderAccessUrl } from "@/lib/orderAccess";
import { prisma } from "@/lib/prisma";

function resultError(result: MessengerDeliveryResult) {
  return result.status === "sent" ? null : result.reason.slice(0, 500);
}

export async function recordMessengerNotificationResult(
  orderId: string,
  event: MessengerEvent,
  result: MessengerDeliveryResult,
) {
  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        messengerNotificationEvent: event,
        messengerNotificationStatus:
          result.status === "sent"
            ? "SENT"
            : result.status === "failed"
              ? "FAILED"
              : "PENDING",
        messengerNotificationAttempts:
          result.status === "skipped" ? undefined : { increment: 1 },
        messengerNotificationLastError: resultError(result),
        messengerNotificationSentAt:
          result.status === "sent" ? new Date() : null,
      },
    });
  } catch (error) {
    console.error("MESSENGER NOTIFICATION STATUS UPDATE ERROR", error);
  }
}

export async function sendOrderMessengerNotification(
  orderId: string,
  event: MessengerEvent,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      customerName: true,
      phone: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      paymentDueAt: true,
      notificationChannel: true,
      notificationContact: true,
      telegramChatId: true,
    },
  });

  if (!order) {
    return {
      status: "skipped",
      provider: "none",
      reason: "order_not_found",
    } as const;
  }

  const access = createOrderAccessToken(order.orderNumber);
  const result = await sendCustomerMessengerNotification(
    {
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      customerName: order.customerName,
      phone: order.phone,
      status: String(order.status),
      paymentMethod: String(order.paymentMethod),
      paymentStatus: String(order.paymentStatus),
      paymentDueAt: order.paymentDueAt,
      notificationChannel: order.notificationChannel,
      notificationContact: order.notificationContact,
      telegramChatId: order.telegramChatId,
      orderAccessUrl: orderAccessUrl(access.token),
    },
    event,
  );

  await recordMessengerNotificationResult(order.id, event, result);
  return result;
}

function inferEvent(order: {
  messengerNotificationEvent: string | null;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
}): MessengerEvent {
  if (
    order.messengerNotificationEvent === "ORDER_CREATED" ||
    order.messengerNotificationEvent === "PAYMENT_REQUIRED" ||
    order.messengerNotificationEvent === "PAYMENT_PAID" ||
    order.messengerNotificationEvent === "STATUS_UPDATE"
  ) {
    return order.messengerNotificationEvent;
  }

  if (order.paymentStatus === "PAID") return "PAYMENT_PAID";
  if (
    order.status === "CONFIRMED" &&
    order.paymentMethod === "KASPI_TRANSFER" &&
    (order.paymentStatus === "UNPAID" || order.paymentStatus === "PENDING")
  ) {
    return "PAYMENT_REQUIRED";
  }
  if (["PACKING", "SHIPPED", "DONE", "CANCELED"].includes(order.status)) {
    return "STATUS_UPDATE";
  }
  return "ORDER_CREATED";
}

export async function retryPendingMessengerNotifications(limit = 8) {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: since },
      notificationChannel: { in: ["WHATSAPP", "TELEGRAM"] },
      messengerNotificationStatus: { in: ["PENDING", "FAILED"] },
      messengerNotificationAttempts: { lt: 5 },
      OR: [
        { notificationChannel: "WHATSAPP" },
        {
          notificationChannel: "TELEGRAM",
          telegramChatId: { not: null },
        },
      ],
    },
    select: {
      id: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      messengerNotificationEvent: true,
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 20),
  });

  let attempted = 0;
  let sent = 0;
  let failed = 0;

  for (const order of orders) {
    const event = inferEvent({
      messengerNotificationEvent: order.messengerNotificationEvent,
      status: String(order.status),
      paymentMethod: String(order.paymentMethod),
      paymentStatus: String(order.paymentStatus),
    });
    const result = await sendOrderMessengerNotification(order.id, event);
    if (result.status !== "skipped") attempted += 1;
    if (result.status === "sent") sent += 1;
    if (result.status === "failed") {
      failed += 1;
      break;
    }
  }

  return { attempted, sent, failed };
}
