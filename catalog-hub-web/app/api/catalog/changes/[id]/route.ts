import { NextRequest, NextResponse } from "next/server";
import { hubFetch, organizationId } from "@/lib/hub";
import { isChangeSetId } from "@/lib/changeset-id";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!isChangeSetId(id)) {
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
    const current=await hubFetch<{organizationId:string}>("/v1/staging/changesets/"+id+"?organizationId="+encodeURIComponent(organizationId));
    if(current.organizationId!==organizationId)return NextResponse.json({error:"changeset_not_found"},{status:404});
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
      (message.startsWith("changeset_stale")||["changeset_payload_invalid","changeset_not_approved","changeset_closed","changeset_not_preview"].includes(message)) ? 409 : 400;
    return NextResponse.json({ error: message }, { status: code });
  }
}
