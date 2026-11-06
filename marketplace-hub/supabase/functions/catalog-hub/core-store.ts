import type postgres from "npm:postgres@3.4.7";
import { digest, nextBalance, operationKey, type Balance } from "./core-domain.ts";
import { RequestError, type Principal } from "./request-context.ts";
export type Sql = ReturnType<typeof postgres>;
export type Tx = postgres.TransactionSql;

export async function once(sql: Sql, req: Request, principal: Principal, route: string, body: unknown,
  execute: (tx: Tx, key: string) => Promise<unknown>) {
  const key = operationKey(req), hash = await digest(body);
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${principal.organizationId + ":" + key},0))`;
    const [old] = await tx`SELECT "route","payloadHash","result" FROM public."CoreMutation"
      WHERE "organizationId"=${principal.organizationId} AND "key"=${key}`;
    if (old) {
      if (old.route !== route || old.payloadHash !== hash) throw new RequestError("idempotency_key_reused", 409);
      return old.result;
    }
    const result = await execute(tx, key);
    await tx`INSERT INTO public."CoreMutation" ("id","organizationId","key","route","payloadHash","result")
      VALUES (${crypto.randomUUID()},${principal.organizationId},${key},${route},${hash},${tx.json(result as postgres.JSONValue)})`;
    return result;
  });
}

export async function lockProducts(tx: Tx, organizationId: string, productIds: string[]) {
  const ids = Array.from(new Set(productIds)).sort();
  const rows = await tx`SELECT "id" FROM public."Product" WHERE "organizationId"=${organizationId}
    AND "id" IN ${tx(ids)} ORDER BY "id" FOR UPDATE`;
  if (rows.length !== ids.length) throw new RequestError("product_not_found", 404);
}

export async function balance(tx: Tx, organizationId: string, productId: string, warehouseId: string, allowInactiveWarehouse = false): Promise<Balance & { id: string | null }> {
  const [warehouse] = await tx`SELECT "id" FROM public."Warehouse" WHERE "id"=${warehouseId}
    AND "organizationId"=${organizationId} AND ("isActive"=true OR ${allowInactiveWarehouse})`;
  if (!warehouse) throw new RequestError("warehouse_not_found", 404);
  const [item] = await tx`SELECT "id","onHand","reserved","safetyStock","revision" FROM public."Inventory"
    WHERE "productId"=${productId} AND "warehouseId"=${warehouseId} FOR UPDATE`;
  return item ? item as Balance & { id: string } : { id: null, onHand: 0, reserved: 0, safetyStock: 0, revision: 0 };
}

export async function outbox(tx: Tx, organizationId: string, topic: string, payload: unknown) {
  await tx`INSERT INTO public."OutboxEvent" ("id","organizationId","topic","payload")
    VALUES (${crypto.randomUUID()},${organizationId},${topic},${tx.json(payload as postgres.JSONValue)})`;
}

export async function changeBalance(tx: Tx, principal: Principal, input: {
  productId: string; warehouseId: string; deltaOnHand: number; deltaReserved: number;
  key: string; ordinal: number; kind: string; reason: string; reference?: string;
  expectedRevision?: number; buffer?: number; allowInactiveWarehouse?: boolean;
}) {
  const before = await balance(tx, principal.organizationId, input.productId, input.warehouseId, input.allowInactiveWarehouse);
  if (input.expectedRevision !== undefined && input.expectedRevision !== before.revision) throw new RequestError("inventory_version_conflict", 409);
  const after = nextBalance(before, input.deltaOnHand, input.deltaReserved, input.buffer);
  if (before.id) {
    await tx`UPDATE public."Inventory" SET "onHand"=${after.onHand},"reserved"=${after.reserved},
      "revision"=${after.revision},"updatedAt"=clock_timestamp() WHERE "id"=${before.id}`;
  } else {
    await tx`INSERT INTO public."Inventory" ("id","productId","warehouseId","onHand","reserved","safetyStock","revision","updatedAt")
      VALUES (${crypto.randomUUID()},${input.productId},${input.warehouseId},${after.onHand},${after.reserved},0,${after.revision},clock_timestamp())`;
  }
  await tx`INSERT INTO public."StockMovement" ("id","organizationId","productId","warehouseId","operationKey","ordinal",
    "kind","deltaOnHand","deltaReserved","beforeOnHand","afterOnHand","beforeReserved","afterReserved","reason","reference","actor")
    VALUES (${crypto.randomUUID()},${principal.organizationId},${input.productId},${input.warehouseId},${input.key},${input.ordinal},
    ${input.kind},${input.deltaOnHand},${input.deltaReserved},${before.onHand},${after.onHand},${before.reserved},${after.reserved},
    ${input.reason},${input.reference || null},${principal.actor})`;
  await outbox(tx, principal.organizationId, "inventory.changed", {
    productId: input.productId, warehouseId: input.warehouseId, onHand: after.onHand,
    reserved: after.reserved, safetyStock: after.safetyStock, revision: after.revision,
  });
  return { onHand: after.onHand, reserved: after.reserved, safetyStock: after.safetyStock, revision: after.revision };
}

/** Existing transactional handlers can participate in a durable row checkpoint.
 * begin() reuses the caller's transaction; no separate connection or commit.
 */
export function transactionalSql(tx: Tx): Sql {
  return new Proxy(tx, {get(target,property,receiver) {
    if(property === "begin") return async (callback: (tx:Tx)=>Promise<unknown>)=>callback(tx);
    return Reflect.get(target,property,receiver);
  }}) as unknown as Sql;
}
