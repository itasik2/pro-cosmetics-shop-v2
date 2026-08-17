export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getMailConfigurationStatus } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { SITE_BRAND } from "@/lib/siteConfig";

export async function GET() {
  const startedAt = Date.now();
  let database: "ok" | "error" = "ok";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "error";
    console.error("HEALTH CHECK DATABASE ERROR", error);
  }

  const mail = getMailConfigurationStatus();
  const ok = database === "ok";

  return NextResponse.json(
    {
      ok,
      service: SITE_BRAND,
      checks: {
        database,
        orderEmail: mail.configured ? "configured" : "not_configured",
      },
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
      responseTimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
