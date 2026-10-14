import { NextRequest, NextResponse } from "next/server";
import { hubFetch, organizationId } from "@/lib/hub";
import { isSameOrigin } from "@/lib/same-origin";
import { isLocalReadOnly } from "@/lib/local-mode";
import { parseEnrichmentAction } from "@/lib/enrichment-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "cache-control": "no-store" };

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  if (isLocalReadOnly()) return NextResponse.json({ error: "local_read_only_mode" }, { status: 403, headers });
  try {
    const input = parseEnrichmentAction(await request.json());
    if (input.action === "source") {
      await hubFetch("/v1/suppliers", { method: "POST", body: JSON.stringify({ organizationId, code: input.supplierCode, name: input.name }) });
      const source = await hubFetch("/v1/source-policies", { method: "POST", body: JSON.stringify({
        organizationId, supplierCode: input.supplierCode, name: input.name,
        domain: new URL(input.sourceUrl).hostname, baseUrl: input.sourceUrl,
        sourceType: input.sourceType, allowSubdomains: false,
      }) });
      return NextResponse.json(source, { headers });
    }
    const root = "/v1/ai/enrichment/";
    const path = input.action === "create" ? "jobs" : input.action === "run"
      ? "jobs/" + encodeURIComponent(input.id) + "/run" : "proposals/" + encodeURIComponent(input.id) + "/stage";
    const payload = input.action === "create" ? {
      organizationId, sku: input.sku, sourceUrl: input.sourceUrl,
      sourceSupplierCode: input.supplierCode,
      discoverIfMissing: true, allowExternalSearch: input.allowExternalSearch,
    } : input.action === "stage" ? {
      organizationId, selectedImageUrl: input.selectedImageUrl,
      selectedMediaVariantId: input.selectedMediaVariantId,
      replaceFilledFields: input.replaceFilledFields, includeBrand: true,
    } : { organizationId };
    return NextResponse.json(await hubFetch(root + path, { method: "POST", body: JSON.stringify(payload) }), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "enrichment_failed" }, { status: 400, headers });
  }
}
