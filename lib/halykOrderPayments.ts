import {
  classifyHalykTransaction,
  generateHalykInvoiceIdCandidate,
  getHalykTransactionStatus,
} from "@/lib/halykEpay";
import {
  recordCustomerNotificationResult,
} from "@/lib/orderNotifications";
import { sendOrderMessengerNotification } from "@/lib/orderMessengerNotifications";
import { notifyCustomerPaymentReceipt } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

export async function ensureHalykInvoiceId(
  orderId: string,
  currentInvoiceId?: string | null,
) {
  if (currentInvoiceId) return currentInvoiceId;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = generateHalykInvoiceIdCandidate();
    const suffix = candidate.slice(-6);
    const collision = await prisma.order.findFirst({
      where: { paymentExternalId: { endsWith: suffix } },
      select: { id: true },
    });
    if (collision) continue;

    const assigned = await prisma.order.updateMany({
      where: { id: orderId, paymentExternalId: null },
      data: {
        paymentProvider: "HALYK_EPAY",
        paymentExternalId: candidate,
        paymentProviderStatus: "CREATED",
        paymentProviderUpdatedAt: new Date(),
      },
    });
    if (assigned.count === 1) return candidate;

    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { paymentExternalId: true },
    });
    if (existing?.paymentExternalId) return existing.paymentExternalId;
  }

  throw new Error("halyk_invoice_id_exhausted");
}

export async function syncHalykOrderPayment(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        select: { title: true, qty: true, lineTotal: true, sku: true },
      },
    },
  });

  if (!order) throw new Error("order_not_found");
  if (!order.paymentExternalId) {
    return { state: "UNPAID" as const, providerStatus: "NOT_STARTED" };
  }

  const rawStatus = await getHalykTransactionStatus(order.paymentExternalId);
  const classified = classifyHalykTransaction(rawStatus, {
    amount: order.totalAmount,
    currency: order.currency,
  });
  const transaction = classified.transaction;
  const providerStatus = classified.statusName || classified.state;

  if (classified.state !== "PAID") {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentProvider: "HALYK_EPAY",
        paymentProviderStatus: providerStatus,
        paymentTransactionId: transaction?.id || null,
        paymentProviderReference: transaction?.reference || null,
        paymentProviderUpdatedAt: new Date(),
      },
    });
    return { state: classified.state, providerStatus };
  }

  if (
    (order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED") &&
    order.paymentProvider !== "HALYK_EPAY"
  ) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentProviderStatus: "CHARGE_AFTER_OTHER_PAYMENT",
        paymentTransactionId: transaction?.id || null,
        paymentProviderReference: transaction?.reference || null,
        paymentProviderUpdatedAt: new Date(),
      },
    });
    return {
      state: "PAID" as const,
      providerStatus: "CHARGE_AFTER_OTHER_PAYMENT",
      duplicatePaymentRisk: true,
    };
  }

  const paidAt = order.paidAt || new Date();
  const updated = await prisma.order.updateMany({
    where: {
      id: order.id,
      paymentStatus: { notIn: ["PAID", "REFUNDED"] },
    },
    data: {
      paymentStatus: "PAID",
      paidAt,
      status: order.status === "NEW" ? "CONFIRMED" : order.status,
      confirmedAt: order.confirmedAt || paidAt,
      paymentProvider: "HALYK_EPAY",
      paymentProviderStatus: "CHARGE",
      paymentTransactionId: transaction?.id || null,
      paymentProviderReference: transaction?.reference || null,
      paymentProviderUpdatedAt: new Date(),
    },
  });

  if (updated.count === 1) {
    if (order.email) {
      const notification = await notifyCustomerPaymentReceipt({
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        customerName: order.customerName,
        phone: order.phone,
        customerEmail: order.email,
        deliveryType: order.deliveryType,
        address: order.address,
        comment: order.comment,
        paymentMethod: "HALYK_EPAY",
        items: order.items,
      });
      await recordCustomerNotificationResult(order.id, notification);
    }

    if (
      order.notificationChannel === "WHATSAPP" ||
      order.notificationChannel === "TELEGRAM"
    ) {
      await sendOrderMessengerNotification(order.id, "PAYMENT_PAID");
    }
  }

  return {
    state: "PAID" as const,
    providerStatus: "CHARGE",
    newlyPaid: updated.count === 1,
  };
}
