import { NextRequest, NextResponse } from "next/server";
import { hubFetch, organizationId, type HubProduct } from "@/lib/hub";
import { isSameOrigin } from "@/lib/same-origin";
import { searchSharedCatalogProduct } from "@/lib/official-search/sharedCatalogSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "cache-control": "no-store" };

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
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
    const result = await searchSharedCatalogProduct(payload);
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "official_search_failed" },
      { status: 502, headers });
  }
}
