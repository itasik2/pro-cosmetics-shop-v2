import { NextRequest, NextResponse } from "next/server";
import { hubFetch, HubApiError, organizationId } from "@/lib/hub";
import { isSameOrigin } from "@/lib/same-origin";
import { isLocalReadOnly, isMutation } from "@/lib/local-mode";
import { boundedJson, RequestError } from "@/lib/request-body";
export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (isMutation(request.method) && !isSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  if (isMutation(request.method) && isLocalReadOnly()) return NextResponse.json({ error: "local_read_only_mode" }, { status: 403 });
  const { path } = await context.params;
  if (path[0] !== "v1" || path.some(part => !/^[\w.-]+$/.test(part) || part === "." || part === "..")) {
    return NextResponse.json({ error: "invalid_api_path" }, { status: 400 });
  }
  const query = new URLSearchParams(request.nextUrl.searchParams);
  if (query.getAll("organizationId").some(value => value !== organizationId)) return NextResponse.json({ error: "organization_forbidden" }, { status: 403 });
  query.set("organizationId", organizationId);
  const requestId=crypto.randomUUID();
  try {
    let body: string | undefined;
    if (isMutation(request.method)) {
      body = JSON.stringify(await boundedJson(request));
    }
    const forwarded: Record<string, string> = {"x-request-id":requestId};
    for (const name of ["idempotency-key", "if-match"]) {
      const value = request.headers.get(name); if (value) forwarded[name] = value;
    }
    const data = await hubFetch("/" + path.join("/") + "?" + query, { method: request.method, body, headers: forwarded });
    return NextResponse.json(data, { headers: { "cache-control": "no-store","x-request-id":requestId } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "proxy_failed" },
      { status: error instanceof HubApiError || error instanceof RequestError ? error.status : 502,headers:{"x-request-id":requestId} });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
