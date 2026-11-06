import { assertScope, RequestError, type Principal } from "./request-context.ts";
import type { Sql } from "./core-store.ts";

type ReconciliationRow = {
  productId:string; warehouseId:string; sku:string; warehouseName:string;
  balanceId:string|null; revision:number|null; onHand:number|null;
  reserved:number; expectedReserved:string; orderReserved:string; standaloneReserved:string;
  activeOrders:number; activeReservations:number; checkedAt:Date|string;
};

export async function reconcileReservations(sql: Sql, principal: Principal, url: URL) {
  assertScope(principal, "/v1/orders", "GET");
  const org = principal.organizationId;
  const productId = url.searchParams.get("productId") || "";
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get("limit"))) || 50));
  let after = ["", ""];
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    try {
      if (cursor.length > 400) throw new Error("invalid_cursor");
      const value = JSON.parse(cursor);
      if (!Array.isArray(value) || value.length !== 2 || value.some(item => typeof item !== "string" || item.length > 128)) {
        throw new Error("invalid_cursor");
      }
      after = value;
    } catch { throw new RequestError("invalid_reconciliation_cursor"); }
  }
  if (productId) {
    const [product] = await sql`SELECT "id" FROM public."Product" WHERE "id"=${productId} AND "organizationId"=${org}`;
    if (!product) throw new RequestError("product_not_found",404);
  }
  // Compare all reservation sources and balances from one MVCC snapshot.
  const rows = await sql<ReconciliationRow[]>`WITH active AS (
    SELECT i."productId",i."warehouseId",sum(i."quantity")::bigint AS expected,
      count(DISTINCT i."orderId")::int AS orders
    FROM public."CoreOrderItem" i JOIN public."CoreOrder" o
      ON o."id"=i."orderId" AND o."organizationId"=i."organizationId"
    WHERE o."organizationId"=${org} AND o."status"='RESERVED'
      AND (${productId}='' OR i."productId"=${productId})
    GROUP BY i."productId",i."warehouseId"
  ), standalone AS (
    SELECT i."productId",i."warehouseId",sum(i."quantity"-i."released"-i."shipped")::bigint AS expected,
      count(DISTINCT i."reservationId")::int AS reservations
    FROM public."ReservationItem" i JOIN public."Reservation" r
      ON r."id"=i."reservationId" AND r."organizationId"=i."organizationId"
    WHERE r."organizationId"=${org} AND r."status"='ACTIVE' AND i."quantity">i."released"+i."shipped"
      AND (${productId}='' OR i."productId"=${productId})
    GROUP BY i."productId",i."warehouseId"
  ), pairs AS (
    SELECT b."productId",b."warehouseId" FROM public."Inventory" b
      JOIN public."Product" p ON p."id"=b."productId" AND p."organizationId"=${org}
      WHERE (${productId}='' OR b."productId"=${productId})
    UNION SELECT "productId","warehouseId" FROM active
    UNION SELECT "productId","warehouseId" FROM standalone
  )
  SELECT pairs."productId",pairs."warehouseId",p."sku",w."name" AS "warehouseName",
    b."id" AS "balanceId",b."revision",b."onHand",
    COALESCE(b."reserved",0)::int AS "reserved",
    (COALESCE(a.expected,0)+COALESCE(s.expected,0))::text AS "expectedReserved",
    COALESCE(a.expected,0)::text AS "orderReserved",COALESCE(s.expected,0)::text AS "standaloneReserved",
    COALESCE(a.orders,0)::int AS "activeOrders",COALESCE(s.reservations,0)::int AS "activeReservations",
    statement_timestamp() AS "checkedAt"
  FROM pairs
    JOIN public."Product" p ON p."id"=pairs."productId" AND p."organizationId"=${org}
    JOIN public."Warehouse" w ON w."id"=pairs."warehouseId" AND w."organizationId"=${org}
    LEFT JOIN public."Inventory" b ON b."productId"=pairs."productId" AND b."warehouseId"=pairs."warehouseId"
    LEFT JOIN active a ON a."productId"=pairs."productId" AND a."warehouseId"=pairs."warehouseId"
    LEFT JOIN standalone s ON s."productId"=pairs."productId" AND s."warehouseId"=pairs."warehouseId"
  WHERE (pairs."productId",pairs."warehouseId")>(${after[0]},${after[1]})
  ORDER BY pairs."productId",pairs."warehouseId" LIMIT ${limit + 1}`;
  const items = rows.slice(0,limit).map(row => {
    const expectedReserved = Number(row.expectedReserved);
    if (!Number.isSafeInteger(expectedReserved)) throw new RequestError("reservation_total_too_large",422);
    const difference = row.reserved - expectedReserved;
    const status = !row.balanceId ? "MISSING_BALANCE" : difference < 0 ? "RESERVATION_SHORTFALL" :
      difference > 0 ? "UNASSIGNED_RESERVED" : "MATCH";
    return { ...row, expectedReserved, orderReserved:Number(row.orderReserved),standaloneReserved:Number(row.standaloneReserved),difference, status };
  });
  const last = items.at(-1);
  return {
    items, nextCursor: rows.length > limit && last ? JSON.stringify([last.productId,last.warehouseId]) : null,
    checked: items.length, mismatches: items.filter(item => item.status !== "MATCH").length,
    checkedAt: items[0]?.checkedAt ?? new Date().toISOString(),
  };
}
