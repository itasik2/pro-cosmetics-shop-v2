export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { runCatalogPopularityMonitor } from "@/lib/popularity/catalogPopularityMonitor";

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
    const result = await runCatalogPopularityMonitor();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("CATALOG POPULARITY MONITOR ERROR", error);
    return NextResponse.json(
      {
        error: "catalog_popularity_monitor_failed",
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
