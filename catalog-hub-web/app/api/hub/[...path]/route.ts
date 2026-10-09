import { NextRequest, NextResponse } from "next/server";

const baseUrl = String(process.env.CATALOG_HUB_API_URL || "").replace(/\/$/, "");
const apiKey = String(process.env.CATALOG_HUB_API_KEY || "");

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!baseUrl || !apiKey) {
    return NextResponse.json({ error: "catalog_hub_proxy_not_configured" }, { status: 503 });
  }

  const { path } = await context.params;
  const target = new URL(baseUrl + "/" + path.join("/"));
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));

  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();

  const response = await fetch(target, {
    method: request.method,
    headers: {
      accept: request.headers.get("accept") || "application/json",
      "content-type": request.headers.get("content-type") || "application/json",
      "x-catalog-hub-key": apiKey,
    },
    body,
    cache: "no-store",
  });

  const bytes = await response.arrayBuffer();
  return new NextResponse(bytes, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
