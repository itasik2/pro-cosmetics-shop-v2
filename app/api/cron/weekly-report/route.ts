export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { sendWeeklySiteReport } from "@/lib/weeklySiteReport";

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
    const report = await sendWeeklySiteReport();
    const delivered = report.delivery.status === "sent";

    return NextResponse.json(
      {
        ok: delivered,
        delivery: report.delivery.status,
        healthChecks: report.healthChecks,
        uptimePercent: report.uptimePercent,
        totalOrders: report.totalOrders,
        totalAmount: report.totalAmount,
        pendingNotifications: report.pendingNotifications,
      },
      { status: delivered ? 200 : 503 },
    );
  } catch (error) {
    console.error("WEEKLY SITE REPORT CRON ERROR", error);
    return NextResponse.json(
      { error: "weekly_site_report_failed" },
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
