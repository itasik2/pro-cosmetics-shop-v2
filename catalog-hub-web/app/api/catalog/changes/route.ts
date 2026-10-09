import { NextRequest, NextResponse } from "next/server";
import { hubFetch, organizationId } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.productId !== "string" || body.productId.length > 128 ||
    !body.proposed || typeof body.proposed !== "object" || Array.isArray(body.proposed)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  try {
    const result = await hubFetch<{ id: string; status: string }>("/v1/staging/changesets", {
      method: "POST",
      body: JSON.stringify({
        organizationId,
        productId: body.productId,
        proposed: body.proposed,
      }),
    });
    return NextResponse.json(result, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "changeset_failed";
    const code = message === "product_not_found" ? 404 : message === "changeset_stale" ? 409 : 400;
    return NextResponse.json({ error: message }, { status: code });
  }
}
