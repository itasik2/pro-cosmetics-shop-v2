import { available, integer, textField } from "./core-domain.ts";
import { balance, changeBalance, lockProducts, once, outbox, type Sql } from "./core-store.ts";
import { RequestError, type Principal } from "./request-context.ts";
import { reconcileReservations } from "./inventory-reconciliation.ts";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function handleStock(req: Request, route: string, url: URL, sql: Sql, principal: Principal): Promise<Response | null> {
  const org = principal.organizationId;
  if (route === "/v1/inventory/reconciliation") {
    if (req.method !== "GET") return json({ error:"method_not_allowed" },405);
    return json(await reconcileReservations(sql,principal,url));
  }
  if(route==="/v1/inventory/warehouses"&&req.method==="POST"){
    const body=await req.json(),name=textField(body.name,"warehouse_name"),code=textField(body.code,"warehouse_code",32).toLocaleUpperCase("ru-RU");
    if(!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u.test(code))throw new RequestError("invalid_warehouse_code");
    return json(await once(sql,req,principal,route,body,async tx=>{
      const [created]=await tx`INSERT INTO public."Warehouse" ("id","organizationId","code","name","isActive","updatedAt")
        VALUES (${crypto.randomUUID()},${org},${code},${name},true,now()) RETURNING "id","code","name","isActive"`;
      await outbox(tx,org,"warehouse.created",{id:created.id,code,actor:principal.actor});return created;
    }),201);
  }
  if (route === "/v1/inventory/balances" && req.method === "GET") {
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(url.searchParams.get("limit"))) || 50));
    const cursor = url.searchParams.get("cursor") || "";
    const productId = url.searchParams.get("productId") || "";
    const rows = await sql`SELECT i.*,p."sku",p."title",w."name" AS "warehouseName" FROM public."Inventory" i
      JOIN public."Product" p ON p."id"=i."productId" JOIN public."Warehouse" w ON w."id"=i."warehouseId" AND w."organizationId"=p."organizationId"
      WHERE p."organizationId"=${org} AND (${cursor}='' OR i."id">${cursor}) AND (${productId}='' OR p."id"=${productId})
      ORDER BY i."id" LIMIT ${limit + 1}`;
    const items = rows.slice(0, limit).map(row => ({ ...row, available: available(row as { onHand: number; reserved: number; safetyStock: number }) }));
    return json({ items, nextCursor: rows.length > limit ? rows[limit - 1].id : null });
  }
  if (route !== "/v1/inventory/movements") return null;
  if (req.method === "GET") {
    const productId = url.searchParams.get("productId") || "", cursor = url.searchParams.get("cursor") || "";
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(url.searchParams.get("limit"))) || 50));
    const rows = await sql`SELECT m.*,p."sku",w."name" AS "warehouseName" FROM public."StockMovement" m
      JOIN public."Product" p ON p."id"=m."productId" AND p."organizationId"=m."organizationId"
      JOIN public."Warehouse" w ON w."id"=m."warehouseId" AND w."organizationId"=m."organizationId"
      WHERE m."organizationId"=${org} AND (${productId}='' OR m."productId"=${productId})
        AND (${cursor}='' OR (m."createdAt",m."id")<(SELECT "createdAt","id" FROM public."StockMovement" WHERE "id"=${cursor} AND "organizationId"=${org}))
      ORDER BY m."createdAt" DESC,m."id" DESC LIMIT ${limit + 1}`;
    return json({ items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json();
  const kind = textField(body.kind, "movement_kind"), productId = textField(body.productId, "product");
  const warehouseId = textField(body.warehouseId, "warehouse"), reason = textField(body.reason, "reason", 500);
  if (reason.length < 5) throw new RequestError("reason_too_short");
  if (!["RECEIVE", "WRITE_OFF", "COUNT", "TRANSFER"].includes(kind)) throw new RequestError("invalid_movement_kind");
  const quantity = integer(body.quantity, "quantity", kind === "COUNT" ? 0 : 1, 100_000);
  const expectedRevision = integer(body.expectedRevision, "expected_revision", 0, 2_000_000_000);
  const target = kind === "TRANSFER" ? textField(body.targetWarehouseId, "target_warehouse") : null;
  if (target === warehouseId) throw new RequestError("transfer_requires_different_warehouses");
  const targetRevision = target ? integer(body.targetExpectedRevision, "target_expected_revision", 0, 2_000_000_000) : null;
  const result = await once(sql, req, principal, route, body, async (tx, key) => {
    await lockProducts(tx, org, [productId]);
    const source = await balance(tx, org, productId, warehouseId);
    const delta = kind === "COUNT" ? quantity - source.onHand : kind === "RECEIVE" ? quantity : -quantity;
    const result = await changeBalance(tx, principal, { productId, warehouseId, deltaOnHand: delta, deltaReserved: 0,
      expectedRevision, key, ordinal: 0, kind, reason, reference: typeof body.reference === "string" ? textField(body.reference, "reference") : undefined });
    let destination = null;
    if (target) destination = await changeBalance(tx, principal, { productId, warehouseId: target, deltaOnHand: quantity, deltaReserved: 0,
      expectedRevision: targetRevision!, key, ordinal: 1, kind, reason, reference: warehouseId });
    return { productId, warehouseId, balance: result, ...(destination ? { targetWarehouseId: target, destination } : {}) };
  });
  return json(result, 201);
}
