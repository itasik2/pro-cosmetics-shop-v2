import { NextRequest, NextResponse } from "next/server";
import { hubFetch, organizationId } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid_changeset_id" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (!body || !["approve", "apply", "reject"].includes(body.action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const approvedFields =
    body.action === "approve" && Array.isArray(body.approvedFields)
      ? body.approvedFields.filter((v: unknown) => typeof v === "string")
      : [];
  try {
    const result = await hubFetch<{ id: string; status: string }>(
      "/v1/staging/changesets/" + id + "/" + body.action,
      {
        method: "POST",
        body: JSON.stringify({ organizationId, approvedFields }),
      },
    );
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "changeset_action_failed";
    const code = message === "changeset_not_found" ? 404 :
      ["changeset_stale","changeset_payload_invalid","changeset_not_approved","changeset_closed","changeset_not_preview"].includes(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status: code });
  }
}
