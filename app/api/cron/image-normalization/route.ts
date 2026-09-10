export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { normalizeCatalogImageBatch } from "@/lib/catalogImageNormalization";

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

export async function GET(req: Request) {
  const forbidden = authorize(req);
  if (forbidden) return forbidden;

  if (process.env.PRODUCT_IMAGE_NORMALIZATION_ENABLED === "false") {
    return NextResponse.json({ ok: true, skipped: true, reason: "disabled" });
  }

  const result = await normalizeCatalogImageBatch(5);
  return NextResponse.json({ ok: true, ...result });
}
