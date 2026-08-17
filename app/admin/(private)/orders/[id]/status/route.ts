// app/admin/(private)/orders/[id]/status/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  recordCustomerNotificationResult,
} from "@/lib/orderNotifications";
import { notifyCustomerPaymentReceipt } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

const Schema = z
  .object({
    status: z
      .enum(["NEW", "CONFIRMED", "PACKING", "SHIPPED", "DONE", "CANCELED"])
      .optional(),
    paymentStatus: z
      .enum(["UNPAID", "PENDING", "PAID", "REFUNDED"])
      .optional(),
  })
  .refine((value) => Boolean(value.status || value.paymentStatus));

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const isAdmin = (session?.user as any)?.role === "admin";
  if (!isAdmin) return NextResponse.redirect(new URL("/admin", req.url));

  const form = await req.formData();
  const rawStatus = String(form.get("status") || "").trim();
  const rawPaymentStatus = String(form.get("paymentStatus") || "").trim();

  const parsed = Schema.safeParse({
    status: rawStatus || undefined,
    paymentStatus: rawPaymentStatus || undefined,
  });
  if (!parsed.success) {
    return NextResponse.redirect(new URL("/admin/orders", req.url));
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      items: {
        select: { title: true, qty: true, lineTotal: true, sku: true },
      },
    },
  });
  if (!order) {
    return NextResponse.redirect(new URL("/admin/orders", req.url));
  }

  const data: Prisma.OrderUpdateInput = {};
  if (parsed.data.status) {
    data.status = parsed.data.status;
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

  return NextResponse.redirect(new URL("/admin/orders", req.url));
}
