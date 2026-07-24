export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { monitorStaleProductSources } from "@/lib/enrichment/monitorSources";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function authorize(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "cron_secret_not_configured" },
      { status: 503 },
    );
  }

  const authorization = req.headers.get("authorization") || "";
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

async function run(req: Request) {
  const forbidden = authorize(req);
  if (forbidden) return forbidden;

  try {
    const result = await monitorStaleProductSources({
      limit: positiveInteger(process.env.ENRICHMENT_MONITOR_BATCH, 4),
      staleHours: positiveInteger(
        process.env.ENRICHMENT_MONITOR_STALE_HOURS,
        24 * 7,
      ),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("ENRICHMENT MONITOR CRON ERROR", error);
    return NextResponse.json(
      {
        error: "enrichment_monitor_failed",
        message: String(
          error && typeof error === "object" && "message" in error
            ? (error as { message?: unknown }).message
            : error,
        ),
      },
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
