export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { searchSharedCatalogProduct } from "@/lib/enrichment/sharedCatalogSearch";

const headers = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const secret = process.env.CATALOG_HUB_SHARED_ENRICHMENT_TOKEN || "";
  if (secret.length < 32) return NextResponse.json({ error: "shared_search_not_configured" }, { status: 503, headers });
  const supplied = request.headers.get("x-catalog-hub-shared-token") || "";
  const a = Buffer.from(secret), b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  if (Number(request.headers.get("content-length") || 0) > 4096)
    return NextResponse.json({ error: "request_too_large" }, { status: 413, headers });
  try {
    const body = await request.text();
    if (body.length > 4096) return NextResponse.json({ error: "request_too_large" }, { status: 413, headers });
    const result = await searchSharedCatalogProduct(JSON.parse(body));
    return NextResponse.json(result, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "shared_search_failed";
    return NextResponse.json({ error: message }, { status: 422, headers });
  }
}
