import { NextResponse } from "next/server";
import {
  catalogPath,
  hubFetch,
  type HubList,
  type HubProduct,
} from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = {
    ok: false,
    service: "catalog-hub-web",
    backend: false,
    auth: false,
    catalog: false,
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
    await hubFetch<HubList<HubProduct>>(
      catalogPath({ limit: 1, offset: 0 }),
    );
    result.auth = true;
    result.catalog = true;
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
