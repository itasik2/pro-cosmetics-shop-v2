export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifyHalykReturnState } from "@/lib/halykEpay";
import { syncHalykOrderPayment } from "@/lib/halykOrderPayments";
import { createOrderAccessToken, orderAccessUrl } from "@/lib/orderAccess";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const invoiceId = String(url.searchParams.get("invoice") || "").trim();
  const state = String(url.searchParams.get("state") || "").trim();
  const result = String(url.searchParams.get("result") || "").trim();

  if (!/^\d{6,15}$/.test(invoiceId)) {
    return NextResponse.redirect(new URL("/", req.url), 303);
  }

  const order = await prisma.order.findUnique({
    where: { paymentExternalId: invoiceId },
    select: { id: true, orderNumber: true },
  });
  if (!order || !verifyHalykReturnState(order.id, invoiceId, state)) {
    return NextResponse.redirect(new URL("/", req.url), 303);
  }

  let paymentResult = result === "failure" ? "failed" : "processing";
  try {
    const synced = await syncHalykOrderPayment(order.id);
    if (synced.state === "PAID") paymentResult = "success";
    else if (synced.state === "FAILED") paymentResult = "failed";
  } catch (error) {
    console.error(
      "HALYK RETURN STATUS ERROR:",
      error instanceof Error ? error.message : error,
    );
  }

  const access = createOrderAccessToken(order.orderNumber);
  const target = new URL(orderAccessUrl(access.token));
  target.searchParams.set("payment", paymentResult);
  return NextResponse.redirect(target, 303);
}
