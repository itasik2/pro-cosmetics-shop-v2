export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { retryPendingOrderNotifications } from "@/lib/orderNotifications";
import { cancelExpiredPrepaymentOrders } from "@/lib/orderPayments";
import { runSiteMonitor } from "@/lib/siteMonitor";

function authorize(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "cron_secret_not_configured" },
      { status: 503 },
    );
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
    const monitor = await runSiteMonitor();
    const orderNotifications = await retryPendingOrderNotifications();
    const expiredOrders = await cancelExpiredPrepaymentOrders();
    return NextResponse.json({
      ok: true,
      healthy: monitor.result.isHealthy,
      responseTimeMs: monitor.result.responseTimeMs,
      checks: monitor.result.checks,
      notification: monitor.notification?.status || null,
      orderNotifications,
      expiredOrders,
    });
  } catch (error) {
    console.error("SITE MONITOR CRON ERROR", error);
    return NextResponse.json(
      { error: "site_monitor_failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
