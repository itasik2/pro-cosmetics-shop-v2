import { NextRequest, NextResponse } from "next/server";
import { hubFetch, organizationId, type HubProduct } from "@/lib/hub";
import { isSameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "cache-control": "no-store" };

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  const base = process.env.PRO_COSMETICS_SHARED_ENRICHMENT_URL || "";
  const token = process.env.CATALOG_HUB_SHARED_ENRICHMENT_TOKEN || "";
  if (!base || token.length < 32)
    return NextResponse.json({ error: "shared_search_not_configured" }, { status: 503, headers });
  let url: URL;
  try {
    url = new URL(base);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV === "development" &&
      url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error();
    if (url.username || url.password || url.search || url.hash) throw new Error();
  } catch {
    return NextResponse.json({ error: "invalid_shared_search_url" }, { status: 503, headers });
  }
  const input = await request.json().catch(() => null);
  if (!input || typeof input.productId !== "string" || !/^[\w-]{1,128}$/.test(input.productId) ||
    (input.sourceUrl !== undefined && (typeof input.sourceUrl !== "string" || input.sourceUrl.length > 2048)) ||
    (input.allowExternalSearch !== undefined && typeof input.allowExternalSearch !== "boolean"))
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers });
  try {
    const product = await hubFetch<HubProduct>("/v1/catalog/products/" + encodeURIComponent(input.productId) +
      "?organizationId=" + encodeURIComponent(organizationId));
    const attributes = product.attributes && typeof product.attributes === "object" && !Array.isArray(product.attributes)
      ? product.attributes as Record<string,unknown> : {};
    const fromTitle = product.title.match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|гр|г|g)(?=$|[^\p{L}\p{N}])/iu);
    const value = Number(attributes.volumeValue || fromTitle?.[1]?.replace(",", "."));
    const payload = {
      product: { sku: product.sku, title: product.title, brand: product.brand || undefined,
        barcode: product.barcode || undefined,
        volumeValue: Number.isFinite(value) && value > 0 ? value : undefined,
        volumeUnit: typeof attributes.volumeUnit === "string" ? attributes.volumeUnit : fromTitle?.[2] },
      sourceUrl: input.sourceUrl?.trim() || undefined,
      allowExternalSearch: input.allowExternalSearch === true,
    };
    const response = await fetch(new URL("/api/internal/catalog-hub/search", url), {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(110_000),
      headers: { "content-type": "application/json", "x-catalog-hub-shared-token": token },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json({ error: String(data?.error || "shared_search_failed") },
      { status: response.status, headers });
    return NextResponse.json(data, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "shared_search_failed" },
      { status: 502, headers });
  }
}
