export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { isQazPostApiConfigured, searchQazPostAddress } from "@/lib/shipping/qazpost";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export async function GET(req: Request) {
  const ip = getClientIp(req);
  if (ip) {
    const rateLimit = checkRateLimit(`qazpost-address:${ip}`, 30, 60_000);
    if (!rateLimit.ok) {
      return NextResponse.json(
        { error: "too_many_requests" },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSec) } },
      );
    }
  }

  if (!isQazPostApiConfigured()) {
    return NextResponse.json(
      { error: "qazpost_not_configured", results: [] },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const query = String(url.searchParams.get("q") || "").replace(/\s+/g, " ").trim();
  if (query.length < 3 || query.length > 250) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchQazPostAddress(query);
    return NextResponse.json({ results });
  } catch (error) {
    console.error("QAZPOST ADDRESS SEARCH ERROR", error);
    return NextResponse.json(
      { error: "qazpost_address_failed", results: [] },
      { status: 502 },
    );
  }
}
