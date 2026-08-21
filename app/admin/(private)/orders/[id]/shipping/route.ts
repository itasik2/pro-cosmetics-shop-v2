export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/adminGuard";
import { sendOrderMessengerNotification } from "@/lib/orderMessengerNotifications";
import { prisma } from "@/lib/prisma";

const SHIPPING_STATUSES = new Set([
  "NOT_CREATED",
  "CREATED",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELED",
  "ERROR",
]);

function clean(value: FormDataEntryValue | null, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseOptionalInt(value: FormDataEntryValue | null, max: number) {
  const text = clean(value, 20);
  if (!text) return null;
  const number = Math.trunc(Number(text));
  if (!Number.isFinite(number) || number < 0 || number > max) return null;
  return number;
}

function safeReturnTo(value: string, orderId: string) {
  return value.startsWith(`/admin/orders/${orderId}`)
    ? value
    : `/admin/orders/${orderId}`;
}

function usesMessenger(channel: string | null) {
  return channel === "WHATSAPP" || channel === "TELEGRAM";
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const form = await req.formData();
  const returnTo = safeReturnTo(clean(form.get("returnTo"), 300), params.id);
  const action = clean(form.get("action"), 40) || "save";

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      trackingNumber: true,
      shippingStatus: true,
      notificationChannel: true,
      archivedAt: true,
    },
  });

  if (!order) redirect("/admin/orders");
  if (order.archivedAt) redirect(`${returnTo}?shippingError=order_archived`);

  const paymentSettled =
    order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED";

  if (action === "mark_shipped") {
    if (order.paymentMethod === "KASPI_TRANSFER" && !paymentSettled) {
      redirect(`${returnTo}?shippingError=payment_required`);
    }
    if (!order.trackingNumber) {
      redirect(`${returnTo}?shippingError=tracking_required`);
    }

    const now = new Date();
    const statusChanged = order.status !== "SHIPPED" || order.shippingStatus !== "SHIPPED";
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "SHIPPED",
        shippingProvider: "QAZPOST",
        shippingStatus: "SHIPPED",
        shippingUpdatedAt: now,
        shippedAt: order.status === "SHIPPED" ? undefined : now,
      },
    });

    if (statusChanged && usesMessenger(order.notificationChannel)) {
      await sendOrderMessengerNotification(order.id, "STATUS_UPDATE");
    }
    redirect(`${returnTo}?shippingSaved=shipped`);
  }

  const trackingNumber = clean(form.get("trackingNumber"), 60).replace(/\s+/g, "");
  if (trackingNumber && !/^[A-Za-z0-9-]{5,60}$/.test(trackingNumber)) {
    redirect(`${returnTo}?shippingError=tracking_invalid`);
  }

  const shippingStatusRaw = clean(form.get("shippingStatus"), 40).toUpperCase();
  const shippingStatus = SHIPPING_STATUSES.has(shippingStatusRaw)
    ? shippingStatusRaw
    : trackingNumber
      ? "CREATED"
      : "NOT_CREATED";

  const serviceCode = clean(form.get("shippingServiceCode"), 80) || null;
  const shippingPrice = parseOptionalInt(form.get("shippingPrice"), 10_000_000);
  const shippingWeightGrams = parseOptionalInt(form.get("shippingWeightGrams"), 100_000);
  const shipmentLabelUrlText = clean(form.get("shipmentLabelUrl"), 2_000);
  let shipmentLabelUrl: string | null = null;
  if (shipmentLabelUrlText) {
    try {
      const url = new URL(shipmentLabelUrlText);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
      shipmentLabelUrl = url.toString();
    } catch {
      redirect(`${returnTo}?shippingError=label_invalid`);
    }
  }

  const markOrderShipped =
    shippingStatus === "SHIPPED" ||
    shippingStatus === "IN_TRANSIT" ||
    shippingStatus === "DELIVERED";

  if (
    markOrderShipped &&
    order.paymentMethod === "KASPI_TRANSFER" &&
    !paymentSettled
  ) {
    redirect(`${returnTo}?shippingError=payment_required`);
  }
  if (shippingStatus === "DELIVERED" && !paymentSettled) {
    redirect(`${returnTo}?shippingError=payment_required`);
  }

  const now = new Date();
  const nextOrderStatus = shippingStatus === "DELIVERED"
    ? "DONE"
    : markOrderShipped
      ? "SHIPPED"
      : order.status;
  const statusChanged =
    order.status !== nextOrderStatus || order.shippingStatus !== shippingStatus;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      shippingProvider: "QAZPOST",
      shippingServiceCode: serviceCode,
      shippingStatus,
      trackingNumber: trackingNumber || null,
      shippingPrice,
      shippingWeightGrams,
      shipmentLabelUrl,
      shippingUpdatedAt: now,
      ...(markOrderShipped
        ? {
            status: nextOrderStatus,
            shippedAt: order.status === "SHIPPED" || order.status === "DONE" ? undefined : now,
            deliveredAt: shippingStatus === "DELIVERED" ? now : undefined,
          }
        : {}),
    },
  });

  if (statusChanged && usesMessenger(order.notificationChannel)) {
    await sendOrderMessengerNotification(order.id, "STATUS_UPDATE");
  }

  redirect(`${returnTo}?shippingSaved=1`);
}
