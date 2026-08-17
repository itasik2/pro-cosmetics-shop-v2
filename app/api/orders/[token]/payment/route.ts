export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { hashOrderAccessToken, orderAccessUrl } from "@/lib/orderAccess";
import { prisma } from "@/lib/prisma";
import { notifyAdminPaymentReported } from "@/lib/notify";

const ReportSchema = z.object({
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function POST(
  req: Request,
  { params }: { params: { token: string } },
) {
  const token = String(params.token || "").trim();
  const hash = hashOrderAccessToken(token);
  const order = await prisma.order.findUnique({
    where: { customerAccessTokenHash: hash },
    include: {
      items: {
        select: { title: true, qty: true, lineTotal: true, sku: true },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  if (order.paymentMethod !== "KASPI_TRANSFER") {
    return NextResponse.json(
      { error: "payment_not_required", message: "Для этого заказа оплата при получении." },
      { status: 400 },
    );
  }

  if (order.status === "CANCELED" || order.status === "DONE") {
    return NextResponse.json(
      { error: "order_closed", message: "Этот заказ уже закрыт." },
      { status: 409 },
    );
  }

  if (order.paymentDueAt && order.paymentDueAt < new Date() && order.paymentStatus === "UNPAID") {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "CANCELED" },
    });
    return NextResponse.json(
      { error: "payment_expired", message: "Срок оплаты истёк, заказ отменён." },
      { status: 410 },
    );
  }

  if (order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED") {
    return NextResponse.json({ ok: true, status: order.paymentStatus });
  }

  if (order.paymentStatus === "PENDING") {
    return NextResponse.json({ ok: true, status: "PENDING" });
  }

  const parsed = ReportSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", message: "Комментарий слишком длинный." },
      { status: 400 },
    );
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: "PENDING",
      paymentReportedAt: new Date(),
      paymentReportedNote: parsed.data.note || null,
    },
  });

  const notification = await notifyAdminPaymentReported({
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
    paymentNote: parsed.data.note || null,
    orderAccessUrl: orderAccessUrl(token),
  });

  return NextResponse.json({
    ok: true,
    status: "PENDING",
    notification: notification.status,
  });
}
