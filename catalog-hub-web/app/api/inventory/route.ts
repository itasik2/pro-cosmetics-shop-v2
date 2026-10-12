import { NextRequest, NextResponse } from "next/server";
import { hubFetch, organizationId } from "@/lib/hub";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId || productId.length > 128) {
    return NextResponse.json({ error: "invalid_product" }, { status: 400 });
  }
  try {
    const history = await hubFetch<unknown>(
      "/v1/inventory/adjustments?organizationId=" + encodeURIComponent(organizationId) +
      "&productId=" + encodeURIComponent(productId)
    );
    return NextResponse.json(history, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "inventory_history_failed" },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  try {
    const result = await hubFetch<unknown>("/v1/inventory/adjustments",{
      method: "POST",
      body: JSON.stringify({
        organizationId,
        productId: body.productId,
        warehouseId: body.warehouseId,
        requestId: body.requestId,
        expectedOnHand: body.expectedOnHand,
        delta: body.delta,
        reason: body.reason,
      }),
    });
    return NextResponse.json(result,{ status:201, headers:{"cache-control":"no-store"} });
  } catch (error) {
    const message=error instanceof Error?error.message:"inventory_adjustment_failed";
    const status=message==="stock_changed_refresh"||message==="stock_below_reserved"||
      message==="request_id_reused"?409:502;
    return NextResponse.json({error:message},{status});
  }
}
