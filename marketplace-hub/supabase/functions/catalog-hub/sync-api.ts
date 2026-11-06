import { integer, retryDelay, textField } from "./core-domain.ts";
import { once, type Sql } from "./core-store.ts";
import { RequestError, type Principal } from "./request-context.ts";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status,
  headers: { "content-type": "application/json", "cache-control": "no-store" } });
const maxInFlight=100;

export async function handleSync(req: Request, route: string, url: URL, sql: Sql, principal: Principal): Promise<Response | null> {
  if (!route.startsWith("/v1/sync/")) return null;
  const org = principal.organizationId;
  if (route === "/v1/sync/status" && req.method === "GET") {
    const [usage]=await sql`SELECT count(*) FILTER (WHERE "status"='PENDING')::int AS pending,
      count(*) FILTER (WHERE "status"='RETRY')::int AS retry,count(*) FILTER (WHERE "status"='DEAD')::int AS dead,
      count(*) FILTER (WHERE "status"='PROCESSING' AND "leaseUntil">statement_timestamp())::int AS "inFlight",
      count(*) FILTER (WHERE "status"='PROCESSING' AND "leaseUntil"<=statement_timestamp())::int AS "expiredLeases",
      min("createdAt") FILTER (WHERE "status" IN ('PENDING','RETRY','PROCESSING')) AS "oldestUndeliveredAt",
      statement_timestamp() AS "checkedAt" FROM public."OutboxEvent" WHERE "organizationId"=${org} AND "status" IN ('PENDING','RETRY','PROCESSING','DEAD')`;
    return json({limits:{inFlight:maxInFlight,claim:100,leaseSeconds:60,attempts:8},usage});
  }
  if (route === "/v1/sync/outbox" && req.method === "GET") {
    const status=url.searchParams.get("status")||"",cursor=url.searchParams.get("cursor")||"";
    if(status&&!["PENDING","RETRY","PROCESSING","DEAD","DELIVERED"].includes(status))throw new RequestError("invalid_outbox_status");
    const limit=Math.min(100,Math.max(1,Math.trunc(Number(url.searchParams.get("limit")))||100));
    const rows = await sql`SELECT "id","topic","status","attempts","availableAt","lastError","createdAt","deliveredAt"
      FROM public."OutboxEvent" WHERE "organizationId"=${org} AND (${status}='' OR "status"=${status})
      AND (${cursor}='' OR ("createdAt","id")<(SELECT "createdAt","id" FROM public."OutboxEvent" WHERE "organizationId"=${org} AND "id"=${cursor}))
      ORDER BY "createdAt" DESC,"id" DESC LIMIT ${limit+1}`;
    const items=rows.slice(0,limit);
    return json({items,nextCursor:rows.length>limit?items.at(-1)?.id:null});
  }
  if (route === "/v1/sync/outbox/claim" && req.method === "POST") {
    const body = await req.json(), limit = integer(body.limit ?? 10,"limit",1,100);
    const result = await once(sql,req,principal,route,body,async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"outbox-claims:"+org},0))`;
      await tx`UPDATE public."OutboxEvent" SET "status"='DEAD',"leaseToken"=null,"leaseUntil"=null,"lastError"='LEASE_EXHAUSTED'
        WHERE "organizationId"=${org} AND "status"='PROCESSING' AND "attempts">=8 AND "leaseUntil"<now()`;
      const [capacity]=await tx`SELECT count(*)::int AS count FROM public."OutboxEvent" WHERE "organizationId"=${org}
        AND "status"='PROCESSING' AND "leaseUntil">statement_timestamp()`;
      const available=Math.max(0,maxInFlight-capacity.count);
      const rows = await tx`SELECT * FROM public."OutboxEvent" WHERE "organizationId"=${org}
        AND "attempts"<8 AND (("status" IN ('PENDING','RETRY') AND "availableAt"<=now())
          OR ("status"='PROCESSING' AND "leaseUntil"<now())) ORDER BY "availableAt","id" LIMIT ${Math.min(limit,available)} FOR UPDATE SKIP LOCKED`;
      const events = [];
      for (const row of rows) {
        const token = crypto.randomUUID();
        const [updated] = await tx`UPDATE public."OutboxEvent" SET "status"='PROCESSING',"attempts"="attempts"+1,
          "leaseToken"=${token},"leaseUntil"=clock_timestamp()+interval '60 seconds' WHERE "id"=${row.id} AND "organizationId"=${org}
          RETURNING "id","topic","payload","attempts","leaseToken","leaseUntil"`;
        events.push(updated);
      }
      return {events,inFlight:capacity.count+events.length,remainingCapacity:available-events.length};
    });
    return json(result);
  }
  const match = route.match(/^\/v1\/sync\/outbox\/([^/]+)\/(ack|fail|retry)$/);
  if (match && req.method === "POST") {
    const id = textField(match[1],"event"), action = match[2], body = await req.json();
    return json(await once(sql,req,principal,route,body,async tx => {
      const [event] = await tx`SELECT * FROM public."OutboxEvent" WHERE "id"=${id} AND "organizationId"=${org} FOR UPDATE`;
      if (!event) throw new RequestError("event_not_found",404);
      if (action === "retry") {
        if (event.status !== "DEAD" || body.confirmed !== true) throw new RequestError("dead_letter_retry_confirmation_required",409);
        await tx`UPDATE public."OutboxEvent" SET "status"='RETRY',"attempts"=0,"availableAt"=now(),"leaseToken"=null,
          "leaseUntil"=null,"lastError"=null WHERE "id"=${id} AND "organizationId"=${org}`;
        return { id, status:"RETRY" };
      }
      if (event.status !== "PROCESSING" || event.leaseToken !== body.leaseToken || new Date(event.leaseUntil).getTime() <= Date.now()) {
        throw new RequestError("event_lease_conflict",409);
      }
      if (action === "ack") {
        await tx`UPDATE public."OutboxEvent" SET "status"='DELIVERED',"deliveredAt"=now(),"leaseToken"=null,"leaseUntil"=null
          WHERE "id"=${id} AND "organizationId"=${org}`;
        return { id,status:"DELIVERED" };
      }
      // Store a bounded error code, never a provider response, URL or secret.
      const code = typeof body.errorCode === "string" && /^[A-Z0-9_]{1,80}$/.test(body.errorCode) ? body.errorCode : "DELIVERY_FAILED";
      const status = event.attempts >= 8 ? "DEAD" : "RETRY", delay = retryDelay(event.attempts);
      await tx`UPDATE public."OutboxEvent" SET "status"=${status},"availableAt"=now()+${delay}*interval '1 second',
        "leaseToken"=null,"leaseUntil"=null,"lastError"=${code} WHERE "id"=${id} AND "organizationId"=${org}`;
      return { id,status };
    }));
  }
  return json({ error:"not_found" },404);
}
