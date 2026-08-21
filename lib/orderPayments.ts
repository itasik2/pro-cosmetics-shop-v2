import type { Prisma } from "@prisma/client";
import { sendOrderMessengerNotification } from "@/lib/orderMessengerNotifications";
import { prisma } from "@/lib/prisma";
import { processStockAlertsForProduct } from "@/lib/stockAlerts";

function asArrayVariants(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

export async function cancelExpiredPrepaymentOrder(
  orderId: string,
  now = new Date(),
) {
  const canceled = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        paymentMethod: true,
        paymentStatus: true,
        paymentDueAt: true,
        status: true,
        notificationChannel: true,
        items: {
          select: {
            productId: true,
            variantId: true,
            qty: true,
          },
        },
      },
    });

    if (
      !order ||
      order.paymentMethod !== "KASPI_TRANSFER" ||
      order.paymentStatus !== "UNPAID" ||
      !order.paymentDueAt ||
      order.paymentDueAt >= now ||
      (order.status !== "NEW" && order.status !== "CONFIRMED")
    ) {
      return {
        canceled: false,
        notificationChannel: null as string | null,
        productIds: [] as string[],
      };
    }

    // Claim the cancellation before restoring stock. If another request has
    // already paid or canceled the order, updateMany returns 0 and nothing is
    // returned to inventory twice.
    const claimed = await tx.order.updateMany({
      where: {
        id: order.id,
        paymentMethod: "KASPI_TRANSFER",
        paymentStatus: "UNPAID",
        paymentDueAt: { lt: now },
        status: { in: ["NEW", "CONFIRMED"] },
      },
      data: { status: "CANCELED" },
    });

    if (claimed.count !== 1) {
      return {
        canceled: false,
        notificationChannel: null as string | null,
        productIds: [] as string[],
      };
    }

    const productIds = new Set<string>();

    for (const item of order.items) {
      if (!item.variantId) {
        const restored = await tx.product.updateMany({
          where: { id: item.productId },
          data: { stock: { increment: item.qty } },
        });
        if (restored.count > 0) productIds.add(item.productId);
        continue;
      }

      const product = await tx.product.findUnique({
        where: { id: item.productId },
        select: { variants: true },
      });
      if (!product) continue;

      const variants = asArrayVariants(product.variants);
      const index = variants.findIndex(
        (variant) => String(variant.id ?? "") === item.variantId,
      );
      if (index < 0) continue;

      const current = variants[index] || {};
      const nextVariants = [...variants];
      nextVariants[index] = {
        ...current,
        stock: Math.max(0, Math.trunc(Number(current.stock) || 0)) + item.qty,
      };

      await tx.product.update({
        where: { id: item.productId },
        data: {
          variants: nextVariants as unknown as Prisma.InputJsonValue,
        },
      });
      productIds.add(item.productId);
    }

    return {
      canceled: true,
      notificationChannel: order.notificationChannel,
      productIds: [...productIds],
    };
  });

  if (!canceled.canceled) {
    return { canceled: false, messengerNotified: false, restockedProducts: 0 };
  }

  for (const productId of canceled.productIds) {
    await processStockAlertsForProduct(productId).catch((error) => {
      console.error("STOCK ALERT AFTER ORDER EXPIRY ERROR", productId, error);
    });
  }

  let messengerNotified = false;
  if (
    canceled.notificationChannel === "WHATSAPP" ||
    canceled.notificationChannel === "TELEGRAM"
  ) {
    const delivery = await sendOrderMessengerNotification(
      orderId,
      "STATUS_UPDATE",
    );
    messengerNotified = delivery.status === "sent";
  }

  return {
    canceled: true,
    messengerNotified,
    restockedProducts: canceled.productIds.length,
  };
}

export async function cancelExpiredPrepaymentOrders(now = new Date()) {
  const expired = await prisma.order.findMany({
    where: {
      paymentMethod: "KASPI_TRANSFER",
      paymentStatus: "UNPAID",
      paymentDueAt: { lt: now },
      status: { in: ["NEW", "CONFIRMED"] },
    },
    select: { id: true },
    orderBy: { paymentDueAt: "asc" },
    take: 100,
  });

  let canceled = 0;
  let messengerNotified = 0;
  let restockedProducts = 0;

  for (const order of expired) {
    const result = await cancelExpiredPrepaymentOrder(order.id, now);
    if (!result.canceled) continue;
    canceled += 1;
    if (result.messengerNotified) messengerNotified += 1;
    restockedProducts += result.restockedProducts;
  }

  return { canceled, messengerNotified, restockedProducts };
}
