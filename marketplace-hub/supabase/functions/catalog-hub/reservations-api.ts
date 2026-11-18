import { digest, integer, orderItems, textField } from "./core-domain.ts";
import { changeBalance, lockProducts, once, outbox, type Sql, type Tx } from "./core-store.ts";
import { RequestError, type Principal } from "./request-context.ts";

const statuses = ["ACTIVE", "RELEASED", "FULFILLED", "PARTIALLY_RETURNED", "RETURNED"];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status,
  headers: { "content-type": "application/json", "cache-control": "no-store" } });
type Item = { id:string; productId:string; warehouseId:string; quantity:number; released:number; shipped:number; returned:number };
const pair = (item: {productId:string;warehouseId:string}) => item.productId + "\0" + item.warehouseId;

function confirmedBody(body: unknown): asserts body is Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("invalid_reservation");
  if ((body as Record<string,unknown>).confirmed !== true) throw new RequestError("confirmation_required");
}
function reasonField(value:unknown) {
  const reason = textField(value,"reason",500);
  if (reason.length<5) throw new RequestError("invalid_reason");
  return reason;
}

async function records(sql: Sql | Tx, org: string, options: {id?:string;cursor?:string;status?:string;limit?:number} = {}) {
  const {id="",cursor="",status="",limit=1} = options;
  return await sql`SELECT r."id",r."reference",r."reason",r."status",r."version",r."createdBy",r."createdAt",r."updatedAt",
    COALESCE((SELECT json_agg(json_build_object('productId',i."productId",'sku',p."sku",'warehouseId',i."warehouseId",
      'warehouseName',w."name",'quantity',i."quantity",'released',i."released",'shipped',i."shipped",'returned',i."returned",
      'remaining',i."quantity"-i."released"-i."shipped",'returnable',i."shipped"-i."returned") ORDER BY i."productId",i."warehouseId")
      FROM public."ReservationItem" i
      JOIN public."Product" p ON p."organizationId"=i."organizationId" AND p."id"=i."productId"
      JOIN public."Warehouse" w ON w."organizationId"=i."organizationId" AND w."id"=i."warehouseId"
      WHERE i."organizationId"=r."organizationId" AND i."reservationId"=r."id"),'[]'::json) AS items
    FROM public."Reservation" r WHERE r."organizationId"=${org}
      AND (${id}='' OR r."id"=${id}) AND (${status}='' OR r."status"=${status})
      AND (${cursor}='' OR (r."createdAt",r."id")<(SELECT "createdAt","id" FROM public."Reservation"
        WHERE "organizationId"=${org} AND "id"=${cursor}))
    ORDER BY r."createdAt" DESC,r."id" DESC LIMIT ${limit}`;
}

export async function handleReservations(req: Request, route: string, url: URL, sql: Sql, principal: Principal): Promise<Response | null> {
  if (route !== "/v1/reservations" && !route.startsWith("/v1/reservations/")) return null;
  const org = principal.organizationId;
  if (route === "/v1/reservations" && req.method === "GET") {
    const status = url.searchParams.get("status") || "";
    if (status && !statuses.includes(status)) throw new RequestError("invalid_reservation_status");
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get("limit"))) || 20));
    const rows = await records(sql, org, {status,limit:limit+1,cursor:url.searchParams.get("cursor") || ""});
    const items = rows.slice(0,limit);
    return json({items,nextCursor:rows.length>limit?items.at(-1)?.id:null});
  }
  const detail = route.match(/^\/v1\/reservations\/([^/]+)$/);
  if (detail && req.method === "GET") {
    const [record] = await records(sql,org,{id:detail[1]});
    if (!record) throw new RequestError("reservation_not_found",404);
    return json(record);
  }
  if (route === "/v1/reservations" && req.method === "POST") {
    const body: unknown = await req.json();
    confirmedBody(body);
    const reference = textField(body.reference,"reservation_reference"), reason = reasonField(body.reason);
    const items = orderItems(body.items);
    const revisions = new Map<string,number>();
    for (const raw of body.items as Record<string,unknown>[]) {
      const item = {productId:textField(raw.productId,"product"),warehouseId:textField(raw.warehouseId,"warehouse")};
      const revision = integer(raw.expectedRevision,"expected_revision",0);
      if (revisions.has(pair(item)) && revisions.get(pair(item)) !== revision) throw new RequestError("inconsistent_inventory_revision");
      revisions.set(pair(item),revision);
    }
    // Stock revisions are preconditions, not part of the business reference identity.
    const hash = await digest({reference,reason,items});
    const result = await once(sql,req,principal,route,body,async (tx,key) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${org+":reservation:"+reference},0))`;
      const [old] = await tx`SELECT "id","payloadHash" FROM public."Reservation"
        WHERE "organizationId"=${org} AND "reference"=${reference} FOR UPDATE`;
      if (old) {
        if (old.payloadHash !== hash) throw new RequestError("reservation_reference_conflict",409);
        return (await records(tx,org,{id:old.id}))[0];
      }
      await lockProducts(tx,org,items.map(item=>item.productId));
      const id = crypto.randomUUID();
      await tx`INSERT INTO public."Reservation" ("id","organizationId","reference","payloadHash","reason","createdBy","updatedAt")
        VALUES (${id},${org},${reference},${hash},${reason},${principal.actor},clock_timestamp())`;
      for (const [ordinal,item] of items.entries()) {
        await changeBalance(tx,principal,{...item,key,ordinal,kind:"RESERVE",deltaOnHand:0,deltaReserved:item.quantity,
          reason,reference:id,expectedRevision:revisions.get(pair(item))});
        await tx`INSERT INTO public."ReservationItem" ("id","organizationId","reservationId","productId","warehouseId","quantity")
          VALUES (${crypto.randomUUID()},${org},${id},${item.productId},${item.warehouseId},${item.quantity})`;
      }
      await outbox(tx,org,"reservation.changed",{reservationId:id,reference,status:"ACTIVE",version:1});
      return (await records(tx,org,{id}))[0];
    });
    return json(result,201);
  }
  const action = route.match(/^\/v1\/reservations\/([^/]+)\/(release|ship|return)$/);
  if (action && req.method === "POST") {
    const body:unknown = await req.json();
    confirmedBody(body);
    const expectedVersion = integer(body.expectedVersion,"expected_version",1), reason = reasonField(body.reason);
    const selected = body.items === undefined ? null : orderItems(body.items);
    const [id,operation] = [action[1],action[2]];
    const result = await once(sql,req,principal,route,body,async (tx,key) => {
      const [reservation] = await tx`SELECT "reference","version" FROM public."Reservation"
        WHERE "organizationId"=${org} AND "id"=${id} FOR UPDATE`;
      if (!reservation) throw new RequestError("reservation_not_found",404);
      if (reservation.version !== expectedVersion) throw new RequestError("reservation_version_conflict",409);
      const items = await tx<Item[]>`SELECT "id","productId","warehouseId","quantity","released","shipped","returned"
        FROM public."ReservationItem" WHERE "organizationId"=${org} AND "reservationId"=${id}
        ORDER BY "productId","warehouseId" FOR UPDATE`;
      if (selected?.some(item=>!items.some(old=>pair(item)===pair(old)))) throw new RequestError("reservation_item_not_found",409);
      const changes = items.map(item=>({...item,count:selected?selected.find(chosen=>pair(chosen)===pair(item))?.quantity || 0:
        operation==="return"?item.shipped-item.returned:item.quantity-item.released-item.shipped})).filter(item=>item.count>0);
      if (!changes.length) throw new RequestError("reservation_nothing_to_apply",409);
      for (const item of changes) {
        const eligible = operation==="return"?item.shipped-item.returned:item.quantity-item.released-item.shipped;
        if (item.count>eligible) throw new RequestError("reservation_quantity_exceeded",409);
      }
      await lockProducts(tx,org,changes.map(item=>item.productId));
      for (const [ordinal,item] of changes.entries()) {
        await changeBalance(tx,principal,{productId:item.productId,warehouseId:item.warehouseId,key,ordinal,
          kind:operation==="release"?"RELEASE":operation==="ship"?"SHIP":"RETURN",
          deltaOnHand:operation==="ship"?-item.count:operation==="return"?item.count:0,
          deltaReserved:operation==="return"?0:-item.count,reason,reference:id,allowInactiveWarehouse:operation==="release"});
        if (operation==="release") await tx`UPDATE public."ReservationItem" SET "released"="released"+${item.count} WHERE "id"=${item.id} AND "organizationId"=${org}`;
        else if (operation==="ship") await tx`UPDATE public."ReservationItem" SET "shipped"="shipped"+${item.count} WHERE "id"=${item.id} AND "organizationId"=${org}`;
        else await tx`UPDATE public."ReservationItem" SET "returned"="returned"+${item.count} WHERE "id"=${item.id} AND "organizationId"=${org}`;
      }
      const [totals] = await tx`SELECT sum("quantity"-"released"-"shipped")::bigint AS remaining,
        sum("shipped")::bigint AS shipped,sum("returned")::bigint AS returned
        FROM public."ReservationItem" WHERE "organizationId"=${org} AND "reservationId"=${id}`;
      const status = Number(totals.remaining)>0?"ACTIVE":Number(totals.shipped)===0?"RELEASED":
        totals.returned===totals.shipped?"RETURNED":Number(totals.returned)>0?"PARTIALLY_RETURNED":"FULFILLED";
      await tx`UPDATE public."Reservation" SET "status"=${status},"version"="version"+1,"updatedAt"=clock_timestamp()
        WHERE "organizationId"=${org} AND "id"=${id}`;
      await outbox(tx,org,"reservation.changed",{reservationId:id,reference:reservation.reference,status,version:expectedVersion+1});
      return (await records(tx,org,{id}))[0];
    });
    return json(result);
  }
  throw new RequestError("unsupported_operation",405);
}
