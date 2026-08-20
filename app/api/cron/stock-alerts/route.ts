export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { processPendingStockAlerts } from "@/lib/stockAlerts";

function authorize(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  }
  if ((req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function run(req: Request) {
  const forbidden = authorize(req);
  if (forbidden) return forbidden;

  try {
    const result = await processPendingStockAlerts(100);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("STOCK ALERT CRON ERROR", error);
    return NextResponse.json({ error: "stock_alert_cron_failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
