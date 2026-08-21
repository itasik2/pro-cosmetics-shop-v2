export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  createHalykPaymentSession,
  createHalykReturnState,
  isHalykEpayConfigured,
} from "@/lib/halykEpay";
import {
  ensureHalykInvoiceId,
  syncHalykOrderPayment,
} from "@/lib/halykOrderPayments";
import { hashOrderAccessToken } from "@/lib/orderAccess";
import { cancelExpiredPrepaymentOrder } from "@/lib/orderPayments";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { getPublicBaseUrl } from "@/lib/siteConfig";

async function getOrder(token: string) {
  return prisma.order.findUnique({
    where: { customerAccessTokenHash: hashOrderAccessToken(token) },
  });
}

function rateLimitResponse(req: Request) {
  const ip = getClientIp(req);
  if (!ip) return null;
  const result = checkRateLimit(`halyk-payment:${ip}`, 12, 60_000);
  if (result.ok) return null;
  return NextResponse.json(
    { error: "too_many_requests", message: "Слишком много запросов. Попробуйте позже." },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSec) },
    },
  );
}

export async function POST(
  req: Request,
  { params }: { params: { token: string } },
) {
  const limited = rateLimitResponse(req);
  if (limited) return limited;

  if (!isHalykEpayConfigured()) {
    return NextResponse.json(
      {
        error: "halyk_not_configured",
        message: "Оплата картой временно недоступна. Используйте перевод на Kaspi.",
      },
      { status: 503 },
    );
  }

  const token = String(params.token || "").trim();
  const order = await getOrder(token);
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  if (order.paymentMethod !== "KASPI_TRANSFER") {
    return NextResponse.json(
      { error: "payment_not_required", message: "Для этого заказа онлайн-оплата не требуется." },
      { status: 400 },
    );
  }

  if (order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED") {
    return NextResponse.json({ ok: true, status: order.paymentStatus });
  }

  if (order.status === "CANCELED" || order.status === "DONE") {
    return NextResponse.json(
      { error: "order_closed", message: "Этот заказ уже закрыт." },
      { status: 409 },
    );
  }

  if (order.paymentDueAt && order.paymentDueAt < new Date()) {
    await cancelExpiredPrepaymentOrder(order.id);
    return NextResponse.json(
      {
        error: "payment_expired",
        message: "Срок оплаты истёк. Заказ отменён, товары возвращены в продажу.",
      },
      { status: 410 },
    );
  }

  try {
    const invoiceId = await ensureHalykInvoiceId(
      order.id,
      order.paymentExternalId,
    );
    const returnState = createHalykReturnState(order.id, invoiceId);
    const baseUrl = getPublicBaseUrl();
    const backLink = `${baseUrl}/payment/halyk/return?invoice=${encodeURIComponent(invoiceId)}&state=${encodeURIComponent(returnState)}&result=success`;
    const failureBackLink = `${baseUrl}/payment/halyk/return?invoice=${encodeURIComponent(invoiceId)}&state=${encodeURIComponent(returnState)}&result=failure`;

    const session = await createHalykPaymentSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      invoiceId,
      amount: order.totalAmount,
      currency: order.currency,
      phone: order.phone,
      email: order.email,
      backLink,
      failureBackLink,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentProvider: "HALYK_EPAY",
        paymentProviderStatus: "PAYMENT_PAGE_READY",
        paymentProviderUpdatedAt: new Date(),
        paymentDueAt:
          order.paymentDueAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return NextResponse.json({ ok: true, status: "READY", ...session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "halyk_failed";
    console.error("HALYK PAYMENT SESSION ERROR:", message);
    return NextResponse.json(
      {
        error: "halyk_session_failed",
        message: "Не удалось открыть платёжную страницу Halyk. Попробуйте ещё раз.",
      },
      { status: 502 },
    );
  }
}

export async function GET(
  req: Request,
  { params }: { params: { token: string } },
) {
  const limited = rateLimitResponse(req);
  if (limited) return limited;

  const token = String(params.token || "").trim();
  const order = await getOrder(token);
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  if (order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED") {
    return NextResponse.json({ ok: true, status: order.paymentStatus });
  }

  if (!order.paymentExternalId) {
    return NextResponse.json({ ok: true, status: "UNPAID" });
  }

  try {
    const result = await syncHalykOrderPayment(order.id);
    return NextResponse.json({ ok: true, status: result.state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "halyk_status_failed";
    console.error("HALYK PAYMENT STATUS ERROR:", message);
    return NextResponse.json(
      {
        error: "halyk_status_failed",
        message: "Не удалось проверить статус оплаты. Попробуйте позже.",
      },
      { status: 502 },
    );
  }
}
