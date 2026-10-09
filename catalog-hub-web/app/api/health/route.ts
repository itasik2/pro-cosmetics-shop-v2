import { NextResponse } from "next/server";
import {
  catalogPath,
  hubFetch,
  organizationId,
  type HubList,
  type HubProduct,
} from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = {
    ok: false,
    service: "catalog-hub-web",
    organizationId,
    backend: false,
    auth: false,
    catalog: false,
    catalogTotal: null as number | null,
  };

  try {
    await hubFetch<Record<string, unknown>>("/health");
    result.backend = true;
  } catch {
    return NextResponse.json(result, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  try {
    const catalog = await hubFetch<HubList<HubProduct>>(
      catalogPath({ limit: 1, offset: 0 }),
    );
    result.auth = true;
    result.catalog = true;
    result.catalogTotal = catalog.pagination.total;
    result.ok = true;

    return NextResponse.json(result, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(result, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
