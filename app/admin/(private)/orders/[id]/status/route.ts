// app/admin/(private)/orders/[id]/status/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  recordCustomerNotificationResult,
  recordPaymentNotificationResult,
} from "@/lib/orderNotifications";
import {
  notifyCustomerPaymentReceipt,
  notifyCustomerPaymentRequired,
} from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

const Schema = z
  .object({
    status: z
      .enum(["NEW", "CONFIRMED", "PACKING", "SHIPPED", "DONE", "CANCELED"])
      .optional(),
    paymentStatus: z
      .enum(["UNPAID", "DUE_ON_DELIVERY", "PENDING", "PAID", "REFUNDED"])
      .optional(),
  })
  .refine((value) => Boolean(value.status || value.paymentStatus));

function redirectToOrders(req: Request, error?: string, orderNumber?: string) {
  const url = new URL("/admin/orders", req.url);
  if (error) {
    url.searchParams.set("error", error);
    if (orderNumber) url.searchParams.set("order", orderNumber);
  }
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const isAdmin = (session?.user as any)?.role === "admin";
  if (!isAdmin) return NextResponse.redirect(new URL("/admin", req.url), 303);

  const form = await req.formData();
  const rawStatus = String(form.get("status") || "").trim();
  const rawPaymentStatus = String(form.get("paymentStatus") || "").trim();

  const parsed = Schema.safeParse({
    status: rawStatus || undefined,
    paymentStatus: rawPaymentStatus || undefined,
  });
  if (!parsed.success) return redirectToOrders(req, "invalid_status");

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      items: {
        select: { title: true, qty: true, lineTotal: true, sku: true },
      },
    },
  });
  if (!order) return redirectToOrders(req, "order_not_found");
  if (order.archivedAt) {
    return redirectToOrders(req, "order_archived", order.orderNumber);
  }

  const targetStatus = parsed.data.status || order.status;
  const targetPaymentStatus = parsed.data.paymentStatus || order.paymentStatus;
  const paymentSettled =
    targetPaymentStatus === "PAID" || targetPaymentStatus === "REFUNDED";

  // Kaspi orders stay in confirmation until payment is manually verified.
  if (
    order.paymentMethod === "KASPI_TRANSFER" &&
    (targetStatus === "PACKING" ||
      targetStatus === "SHIPPED" ||
      targetStatus === "DONE") &&
    !paymentSettled
  ) {
    return redirectToOrders(req, "payment_required", order.orderNumber);
  }
  if (targetStatus === "DONE" && !paymentSettled) {
    return redirectToOrders(req, "payment_required", order.orderNumber);
  }

  const data: Prisma.OrderUpdateInput = {};
  const statusWasChangedToConfirmed =
    parsed.data.status === "CONFIRMED" && order.status !== "CONFIRMED";
  let paymentDueAt = order.paymentDueAt;

  if (parsed.data.status) data.status = parsed.data.status;

  if (statusWasChangedToConfirmed) {
    const confirmedAt = order.confirmedAt || new Date();
    data.confirmedAt = confirmedAt;
    if (
      order.paymentMethod === "KASPI_TRANSFER" &&
      !paymentSettled &&
      !order.paymentDueAt
    ) {
      paymentDueAt = new Date(confirmedAt.getTime() + 24 * 60 * 60 * 1000);
      data.paymentDueAt = paymentDueAt;
    }
  }

  const paymentWasChangedToPaid =
    parsed.data.paymentStatus === "PAID" && order.paymentStatus !== "PAID";

  if (parsed.data.paymentStatus) {
    data.paymentStatus = parsed.data.paymentStatus;
    data.paidAt =
      parsed.data.paymentStatus === "PAID" ? order.paidAt || new Date() : null;
  }

  await prisma.order.update({
    where: { id: order.id },
    data,
  });

  if (paymentWasChangedToPaid && order.email) {
    const result = await notifyCustomerPaymentReceipt({
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
    await recordCustomerNotificationResult(order.id, result);
  }

  if (
    statusWasChangedToConfirmed &&
    order.paymentMethod === "KASPI_TRANSFER" &&
    order.email &&
    !paymentSettled
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
      paymentDueAt,
    });
    await recordPaymentNotificationResult(order.id, result);
  }

  return redirectToOrders(req);
}
