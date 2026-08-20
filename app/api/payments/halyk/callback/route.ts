export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifyHalykCallbackSecret } from "@/lib/halykEpay";
import { syncHalykOrderPayment } from "@/lib/halykOrderPayments";
import { prisma } from "@/lib/prisma";

async function readPayload(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await req.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const text = await req.text();
  if (!text) return {} as Record<string, unknown>;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
}

export async function POST(req: Request) {
  const payload = await readPayload(req);
  const invoiceId = String(payload.invoiceId || payload.invoiceID || "").trim();
  const secretHash = String(
    payload.secret_hash || payload.secretHash || "",
  ).trim();

  if (!/^\d{6,15}$/.test(invoiceId)) {
    return NextResponse.json({ error: "invalid_invoice" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { paymentExternalId: invoiceId },
    select: { id: true, orderNumber: true },
  });
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  if (!verifyHalykCallbackSecret(order.id, invoiceId, secretHash)) {
    console.error("HALYK CALLBACK SIGNATURE MISMATCH:", {
      orderNumber: order.orderNumber,
      invoiceId,
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  try {
    const result = await syncHalykOrderPayment(order.id);
    return NextResponse.json({ ok: true, status: result.state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "halyk_callback_failed";
    console.error("HALYK CALLBACK STATUS ERROR:", {
      orderNumber: order.orderNumber,
      invoiceId,
      message,
    });

    // A successful HTTP response prevents callback storms. The customer return route
    // and the order page can request the authoritative transaction status again.
    return NextResponse.json({ ok: true, status: "RECHECK_REQUIRED" });
  }
}
