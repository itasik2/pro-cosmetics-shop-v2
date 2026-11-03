import { available, digest, integer, orderItems, textField, type OrderItem } from "./core-domain.ts";
import { balance, changeBalance, lockProducts, once, outbox, type Sql, type Tx } from "./core-store.ts";
import { RequestError, type Principal } from "./request-context.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status,
  headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function resolveItems(tx: Tx, organizationId: string, connectionId: string, value: unknown): Promise<OrderItem[]> {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new RequestError("invalid_order_items");
  const items = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestError("invalid_order_item");
    const item = raw as Record<string, unknown>;
    if (item.sellerSku !== undefined) {
      const sellerSku = textField(item.sellerSku, "seller_sku");
      const externalWarehouseId = textField(item.externalWarehouseId, "external_warehouse");
      const [offer] = await tx`SELECT "productId" FROM public."ChannelOffer" WHERE "organizationId"=${organizationId}
        AND "connectionId"=${connectionId} AND "sellerSku"=${sellerSku} AND "isActive"=true`;
      const [warehouse] = await tx`SELECT "warehouseId" FROM public."ChannelWarehouseMapping" WHERE "organizationId"=${organizationId}
        AND "connectionId"=${connectionId} AND "externalId"=${externalWarehouseId}`;
      if (!offer || !warehouse) throw new RequestError("channel_mapping_missing", 409);
      items.push({ productId: offer.productId, warehouseId: warehouse.warehouseId, quantity: item.quantity });
    } else items.push(item);
  }
  return orderItems(items);
}

async function orderRecord(tx: Tx, organizationId: string, id: string) {
  const [order] = await tx`SELECT o.*, COALESCE((SELECT json_agg(json_build_object(
    'productId',i."productId",'warehouseId',i."warehouseId",'quantity',i."quantity",'returned',i."returned"))
    FROM public."CoreOrderItem" i WHERE i."organizationId"=o."organizationId" AND i."orderId"=o."id"),'[]'::json) AS items
    FROM public."CoreOrder" o WHERE o."organizationId"=${organizationId} AND o."id"=${id}`;
  return order;
}

export async function handleOrders(req: Request, route: string, url: URL, sql: Sql, principal: Principal): Promise<Response | null> {
  if (!route.startsWith("/v1/orders")) return null;
  const org = principal.organizationId;
  if (route === "/v1/orders" && req.method === "GET") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const cursor = url.searchParams.get("cursor") || "";
    const rows = await sql`SELECT o.*, c."name" AS "channelName",
      COALESCE((SELECT json_agg(json_build_object('productId',i."productId",'sku',p."sku",'warehouseId',i."warehouseId",
        'quantity',i."quantity",'returned',i."returned")) FROM public."CoreOrderItem" i JOIN public."Product" p ON p."id"=i."productId"
        WHERE i."organizationId"=o."organizationId" AND i."orderId"=o."id"),'[]'::json) AS items
      FROM public."CoreOrder" o JOIN public."ChannelConnection" c ON c."id"=o."connectionId" AND c."organizationId"=o."organizationId"
      WHERE o."organizationId"=${org} AND (${cursor}='' OR o."id"<${cursor}) ORDER BY o."id" DESC LIMIT ${limit + 1}`;
    const items = rows.slice(0, limit);
    return json({ items, nextCursor: rows.length > limit ? items.at(-1)?.id : null });
  }
  if ((route === "/v1/orders/events" || route === "/v1/orders/events/preview") && req.method === "POST") {
    const body = await req.json();
    const connectionId = textField(body.connectionId, "connection"), externalOrderId = textField(body.externalOrderId, "external_order");
    const eventId = textField(body.externalEventId, "external_event"), eventType = textField(body.type, "event_type");
    if (!["CREATED", "CANCELED", "SHIPPED", "RETURNED"].includes(eventType)) throw new RequestError("unsupported_order_event", 422);
    if (route.endsWith("/preview")) {
      const result = await sql.begin(async tx => {
        const [connection] = await tx`SELECT "adapter","mode" FROM public."ChannelConnection" WHERE "organizationId"=${org} AND "id"=${connectionId}`;
        if (!connection) throw new RequestError("channel_not_found", 404);
        if (connection.adapter !== "OWN_STORE") throw new RequestError("unsupported_operation", 422);
        if (eventType !== "CREATED") throw new RequestError("preview_requires_created_event");
        const items = await resolveItems(tx, org, connectionId, body.items);
        await lockProducts(tx, org, items.map(i => i.productId));
        const checks = [];
        for (const item of items) {
          const stock = await balance(tx, org, item.productId, item.warehouseId);
          const [offer] = await tx`SELECT "channelBuffer" FROM public."ChannelOffer" WHERE "organizationId"=${org}
            AND "connectionId"=${connectionId} AND "productId"=${item.productId} AND "isActive"=true`;
          const quantity = available(stock, Number(offer?.channelBuffer || 0));
          checks.push({ ...item, available: quantity, canReserve: quantity >= item.quantity });
        }
        return { mode: "SHADOW", changesApplied: false, checks, canReserve: checks.every(i => i.canReserve) };
      });
      return json(result);
    }
    const result = await once(sql, req, principal, route, body, async (tx, key) => {
      // This lock also serializes distinct event IDs for the same external order.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${org + ":order:" + connectionId + ":" + externalOrderId},0))`;
      const [connection] = await tx`SELECT "adapter","mode" FROM public."ChannelConnection" WHERE "organizationId"=${org} AND "id"=${connectionId} FOR SHARE`;
      if (!connection) throw new RequestError("channel_not_found", 404);
      if (connection.adapter !== "OWN_STORE") throw new RequestError("unsupported_operation", 422);
      if (connection.mode !== "ACTIVE") throw new RequestError("channel_not_active", 409);
      const hash = await digest({ externalOrderId, eventType, items: body.items ?? null });
      const [seen] = await tx`SELECT "payloadHash","result" FROM public."InboxEvent" WHERE "organizationId"=${org}
        AND "connectionId"=${connectionId} AND "externalEventId"=${eventId}`;
      if (seen) {
        if (seen.payloadHash !== hash) throw new RequestError("external_event_reused", 409);
        return seen.result;
      }
      let [order] = await tx`SELECT * FROM public."CoreOrder" WHERE "organizationId"=${org} AND "connectionId"=${connectionId}
        AND "externalOrderId"=${externalOrderId} FOR UPDATE`;
      if (eventType === "CREATED") {
        const items = await resolveItems(tx, org, connectionId, body.items), itemHash = await digest(items);
        if (order) {
          if (order.itemHash !== itemHash) throw new RequestError("order_items_conflict", 409);
        } else {
          await lockProducts(tx, org, items.map(i => i.productId));
          const id = crypto.randomUUID();
          await tx`INSERT INTO public."CoreOrder" ("id","organizationId","connectionId","externalOrderId","status","itemHash","updatedAt")
            VALUES (${id},${org},${connectionId},${externalOrderId},'RESERVED',${itemHash},now())`;
          for (const [ordinal, item] of items.entries()) {
            const [offer] = await tx`SELECT "channelBuffer" FROM public."ChannelOffer" WHERE "organizationId"=${org}
              AND "connectionId"=${connectionId} AND "productId"=${item.productId} AND "isActive"=true`;
            await changeBalance(tx, principal, { ...item, key, ordinal, kind: "RESERVE", deltaOnHand: 0, deltaReserved: item.quantity,
              reason: "Резерв заказа", reference: id, buffer: Number(offer?.channelBuffer || 0) });
            await tx`INSERT INTO public."CoreOrderItem" ("id","organizationId","orderId","productId","warehouseId","quantity")
              VALUES (${crypto.randomUUID()},${org},${id},${item.productId},${item.warehouseId},${item.quantity})`;
          }
          [order] = await tx`SELECT * FROM public."CoreOrder" WHERE "id"=${id} AND "organizationId"=${org}`;
        }
      } else {
        if (!order) throw new RequestError("order_not_found", 404);
        const items = await tx`SELECT * FROM public."CoreOrderItem" WHERE "organizationId"=${org} AND "orderId"=${order.id}
          ORDER BY "productId","warehouseId" FOR UPDATE`;
        const repeat = eventType === "CANCELED" && order.status === "CANCELED" ||
          eventType === "SHIPPED" && ["SHIPPED", "PARTIALLY_RETURNED", "RETURNED"].includes(order.status) ||
          eventType === "RETURNED" && order.status === "RETURNED";
        if (!repeat) {
          if ((eventType === "CANCELED" || eventType === "SHIPPED") && order.status !== "RESERVED" ||
              eventType === "RETURNED" && !["SHIPPED", "PARTIALLY_RETURNED"].includes(order.status)) {
            throw new RequestError("order_transition_forbidden", 409);
          }
          await lockProducts(tx, org, items.map(i => i.productId));
          const returned = eventType === "RETURNED" && body.items !== undefined ? orderItems(body.items) : null;
          if (returned && returned.some(i => !items.some(old => old.productId === i.productId && old.warehouseId === i.warehouseId))) {
            throw new RequestError("return_item_not_in_order", 409);
          }
          for (const [ordinal, item] of items.entries()) {
            const quantity = eventType === "RETURNED" ? returned
              ? returned.find(i => i.productId === item.productId && i.warehouseId === item.warehouseId)?.quantity || 0
              : item.quantity - item.returned : item.quantity;
            if (!quantity) continue;
            if (eventType === "RETURNED" && quantity > item.quantity - item.returned) throw new RequestError("return_exceeds_shipped", 409);
            await changeBalance(tx, principal, { productId: item.productId, warehouseId: item.warehouseId, key, ordinal,
              kind: eventType === "CANCELED" ? "RELEASE" : eventType === "SHIPPED" ? "SHIP" : "RETURN",
              deltaOnHand: eventType === "SHIPPED" ? -quantity : eventType === "RETURNED" ? quantity : 0,
              deltaReserved: eventType === "RETURNED" ? 0 : -quantity,
              reason: eventType === "CANCELED" ? "Отмена заказа" : eventType === "SHIPPED" ? "Отгрузка заказа" : "Возврат заказа", reference: order.id });
            if (eventType === "RETURNED") await tx`UPDATE public."CoreOrderItem" SET "returned"="returned"+${quantity}
              WHERE "id"=${item.id} AND "organizationId"=${org}`;
          }
          const [remaining] = await tx`SELECT COALESCE(sum("quantity"-"returned"),0)::int AS count FROM public."CoreOrderItem"
            WHERE "organizationId"=${org} AND "orderId"=${order.id}`;
          const status = eventType === "RETURNED" ? remaining.count ? "PARTIALLY_RETURNED" : "RETURNED" : eventType;
          await tx`UPDATE public."CoreOrder" SET "status"=${status},"version"="version"+1,"updatedAt"=now()
            WHERE "id"=${order.id} AND "organizationId"=${org}`;
        }
      }
      const result = await orderRecord(tx, org, order.id);
      await tx`INSERT INTO public."InboxEvent" ("id","organizationId","connectionId","externalEventId","eventType","payloadHash","result")
        VALUES (${crypto.randomUUID()},${org},${connectionId},${eventId},${eventType},${hash},${tx.json(result)})`;
      await outbox(tx, org, "order.changed", { id: result.id, connectionId, externalOrderId, status: result.status, version: result.version });
      return result;
    });
    return json(result, 200);
  }
  return json({ error: "not_found" }, 404);
}
