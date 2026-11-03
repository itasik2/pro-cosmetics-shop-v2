import { adapters, available, integer, textField } from "./core-domain.ts";
import { kaspiFeed, validateManifest, type FeedOffer } from "./channel-feed.ts";
import { once, outbox, type Sql } from "./core-store.ts";
import { RequestError, type Principal } from "./request-context.ts";
import {assertFinancialPrice,channelCode,financialPolicy} from "./channel-pricing.ts";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status,
  headers: { "content-type": "application/json", "cache-control": "no-store" } });
type Adapter = keyof typeof adapters;

export async function handleChannels(req: Request, route: string, url: URL, sql: Sql, principal: Principal): Promise<Response | null> {
  if (!route.startsWith("/v1/channels")) return null;
  const org = principal.organizationId;
  if (route === "/v1/channels/adapters" && req.method === "GET") return json(Object.entries(adapters).map(([id, spec]) => ({ id, ...spec })));
  if (route === "/v1/channels" && req.method === "GET") {
    const rows = await sql`SELECT c.*, (SELECT count(*)::int FROM public."ChannelOffer" o WHERE o."organizationId"=c."organizationId"
      AND o."connectionId"=c."id" AND o."isActive"=true) AS "offerCount" FROM public."ChannelConnection" c
      WHERE c."organizationId"=${org} ORDER BY c."createdAt" DESC LIMIT 100`;
    return json(rows.map(row => ({ ...row, capabilities: adapters[row.adapter as Adapter]?.capabilities || [] })));
  }
  if (route === "/v1/channels" && req.method === "POST") {
    const body = await req.json(), name = textField(body.name, "channel_name"), adapter = textField(body.adapter, "adapter") as Adapter;
    if (!Object.hasOwn(adapters, adapter)) throw new RequestError("unsupported_adapter", 422);
    const environment = body.environment === "PRODUCTION" ? "PRODUCTION" : "TEST";
    if (body.secretRef !== undefined && !/^[A-Z][A-Z0-9_]{2,100}$/.test(body.secretRef)) throw new RequestError("invalid_secret_ref");
    const result = await once(sql, req, principal, route, body, async tx => {
      const [created] = await tx`INSERT INTO public."ChannelConnection" ("id","organizationId","name","kind","adapter","environment","mode","secretRef","updatedAt")
        VALUES (${crypto.randomUUID()},${org},${name},${adapters[adapter].kind},${adapter},${environment},'SHADOW',${body.secretRef || null},now()) RETURNING *`;
      await outbox(tx, org, "channel.created", { id: created.id, adapter, environment, actor: principal.actor });
      return created;
    });
    return json(result, 201);
  }
  const match = route.match(/^\/v1\/channels\/([^/]+)(?:\/(mode|offers|mappings|feed-preview|export|health))?$/);
  if (!match) return json({ error: "unsupported_operation" }, 422);
  const id = textField(decodeURIComponent(match[1]), "connection"), action = match[2];
  const [connection] = await sql`SELECT * FROM public."ChannelConnection" WHERE "id"=${id} AND "organizationId"=${org}`;
  if (!connection) throw new RequestError("channel_not_found", 404);
  if (!action && req.method === "GET") return json({ ...connection, capabilities: adapters[connection.adapter as Adapter]?.capabilities || [] });
  if (action === "health" && req.method === "GET") return json({ status: "CONFIGURED", remoteVerified: false,
    mode: connection.mode, capabilities: adapters[connection.adapter as Adapter]?.capabilities || [] });
  if (action === "mode" && req.method === "POST") {
    const body = await req.json(), version = integer(body.expectedVersion, "expected_version", 1, 2_000_000_000);
    if (!["SHADOW", "ACTIVE", "PAUSED"].includes(body.mode)) throw new RequestError("invalid_channel_mode");
    if (body.mode === "ACTIVE" && body.confirmed !== true) throw new RequestError("channel_activation_confirmation_required");
    // Production cutover requires a verified pilot and rollback plan, not an unchecked toggle.
    if (body.mode === "ACTIVE" && connection.environment === "PRODUCTION") throw new RequestError("production_cutover_not_enabled", 409);
    if (body.mode === "ACTIVE" && connection.adapter !== "OWN_STORE") throw new RequestError("unsupported_operation", 422);
    return json(await once(sql, req, principal, route, body, async tx => {
      const [updated] = await tx`UPDATE public."ChannelConnection" SET "mode"=${body.mode},"version"="version"+1,"updatedAt"=now()
        WHERE "organizationId"=${org} AND "id"=${id} AND "version"=${version} RETURNING *`;
      if (!updated) throw new RequestError("channel_version_conflict", 409);
      await outbox(tx, org, "channel.mode_changed", { id, mode: body.mode, actor: principal.actor, version: updated.version });
      return updated;
    }));
  }
  if (action === "offers" && req.method === "GET") {
    const productId=url.searchParams.get("productId") || "";
    const rows = await sql`SELECT o.*,p."title",p."sku" AS "internalSku" FROM public."ChannelOffer" o
      JOIN public."CatalogProductRead" p ON p."id"=o."productId" AND p."organizationId"=o."organizationId"
      WHERE o."organizationId"=${org} AND o."connectionId"=${id} AND (${productId}='' OR o."productId"=${productId})
      ORDER BY o."sellerSku" LIMIT 100`;
    return json(rows);
  }
  if (action === "offers" && req.method === "POST") {
    const body = await req.json(), productId = textField(body.productId, "product"), sellerSku = textField(body.sellerSku, "seller_sku");
    const version = integer(body.expectedVersion, "expected_version", 0, 2_000_000_000);
    if (connection.adapter === "KASPI_XML" && !/^[A-Za-z0-9]{1,20}$/.test(sellerSku)) throw new RequestError("invalid_kaspi_seller_sku");
    const price = body.price == null ? null : integer(body.price, "offer_price", 1, 1_000_000_000);
    const buffer = integer(body.channelBuffer ?? 0, "channel_buffer", 0, 100_000);
    const preorder = body.preorderDays == null ? null : integer(body.preorderDays, "preorder_days", 1, 30);
    return json(await once(sql, req, principal, route, body, async tx => {
      const [product] = await tx`SELECT "id","purchasePrice" FROM public."Product" WHERE "id"=${productId} AND "organizationId"=${org} FOR SHARE`;
      if (!product) throw new RequestError("product_not_found", 404);
      if (price !== null) {
        const [policy]=await tx`SELECT * FROM public."ChannelRepricingPolicy" WHERE "organizationId"=${org}
          AND "productId"=${productId} AND "channel"=${channelCode(connection.adapter) || ""} FOR SHARE`;
        assertFinancialPrice(price,product.purchasePrice,financialPolicy(policy));
      }
      const [old] = await tx`SELECT * FROM public."ChannelOffer" WHERE "organizationId"=${org} AND "connectionId"=${id} AND "productId"=${productId} FOR UPDATE`;
      if ((old?.version ?? 0) !== version) throw new RequestError("offer_version_conflict", 409);
      const offerId = old?.id || crypto.randomUUID();
      const [saved] = await tx`INSERT INTO public."ChannelOffer" ("id","organizationId","connectionId","productId","sellerSku","price","channelBuffer","preorderDays","isActive","updatedAt")
        VALUES (${offerId},${org},${id},${productId},${sellerSku},${price},${buffer},${preorder},${body.isActive !== false},now())
        ON CONFLICT ("id") DO UPDATE SET "sellerSku"=EXCLUDED."sellerSku","price"=EXCLUDED."price","channelBuffer"=EXCLUDED."channelBuffer",
          "preorderDays"=EXCLUDED."preorderDays","isActive"=EXCLUDED."isActive","version"="ChannelOffer"."version"+1,"updatedAt"=now() RETURNING *`;
      await outbox(tx, org, "channel.offer_changed", { connectionId: id, id: offerId, version: saved.version, actor: principal.actor });
      return saved;
    }));
  }
  if (action === "mappings" && req.method === "GET") {
    const [warehouses, categories] = await Promise.all([
      sql`SELECT * FROM public."ChannelWarehouseMapping" WHERE "organizationId"=${org} AND "connectionId"=${id}`,
      sql`SELECT * FROM public."ChannelCategoryMapping" WHERE "organizationId"=${org} AND "connectionId"=${id}`,
    ]);
    return json({ warehouses, categories, settings: connection.settings });
  }
  if (action === "mappings" && req.method === "POST") {
    const body = await req.json(), version = integer(body.expectedVersion, "expected_version", 1, 2_000_000_000);
    const warehouses = body.warehouses ?? [], categories = body.categories ?? [];
    if (!Array.isArray(warehouses) || warehouses.length > 100 || !Array.isArray(categories) || categories.length > 1000) throw new RequestError("invalid_mappings");
    if (body.settings !== undefined && (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings))) throw new RequestError("invalid_channel_settings");
    return json(await once(sql, req, principal, route, body, async tx => {
      const [locked] = await tx`SELECT "version","settings" FROM public."ChannelConnection" WHERE "organizationId"=${org} AND "id"=${id} FOR UPDATE`;
      if (locked.version !== version) throw new RequestError("channel_version_conflict", 409);
      for (const mapping of warehouses) {
        const warehouseId = textField(mapping.warehouseId, "warehouse"), externalId = textField(mapping.externalId, "external_warehouse");
        const [warehouse] = await tx`SELECT "id" FROM public."Warehouse" WHERE "organizationId"=${org} AND "id"=${warehouseId} AND "isActive"=true`;
        if (!warehouse) throw new RequestError("warehouse_not_found", 404);
        await tx`INSERT INTO public."ChannelWarehouseMapping" ("id","organizationId","connectionId","warehouseId","externalId")
          VALUES (${crypto.randomUUID()},${org},${id},${warehouseId},${externalId}) ON CONFLICT ("organizationId","connectionId","warehouseId")
          DO UPDATE SET "externalId"=EXCLUDED."externalId"`;
      }
      for (const mapping of categories) {
        const categoryKey = textField(mapping.categoryKey, "category"), externalId = textField(mapping.externalId, "external_category");
        const [category] = await tx`SELECT "id" FROM public."CatalogCategory" WHERE "organizationId"=${org} AND "key"=${categoryKey} AND "isActive"=true`;
        if (!category) throw new RequestError("category_not_found", 404);
        await tx`INSERT INTO public."ChannelCategoryMapping" ("id","organizationId","connectionId","categoryKey","externalId")
          VALUES (${crypto.randomUUID()},${org},${id},${categoryKey},${externalId}) ON CONFLICT ("organizationId","connectionId","categoryKey")
          DO UPDATE SET "externalId"=EXCLUDED."externalId"`;
      }
      // Only operational metadata is accepted here; credentials are secretRef values.
      const settings = body.settings === undefined ? locked.settings : {
        company: typeof body.settings.company === "string" ? body.settings.company.slice(0,200) : null,
        merchantId: typeof body.settings.merchantId === "string" ? body.settings.merchantId.slice(0,128) : null,
        expectedSellerSkus: Array.isArray(body.settings.expectedSellerSkus) ? body.settings.expectedSellerSkus.map((x: unknown) => textField(x,"seller_sku")) : null,
      };
      const [updated] = await tx`UPDATE public."ChannelConnection" SET "settings"=${tx.json(settings)},"version"="version"+1,"updatedAt"=now()
        WHERE "organizationId"=${org} AND "id"=${id} RETURNING *`;
      await outbox(tx, org, "channel.mappings_changed", { id, version: updated.version, actor: principal.actor });
      return updated;
    }));
  }
  if ((action === "feed-preview" || action === "export") && req.method === "GET") {
    return json(await sql.begin("isolation level repeatable read", async tx => {
      const [current] = await tx`SELECT * FROM public."ChannelConnection" WHERE "organizationId"=${org} AND "id"=${id}`;
      const offers = await tx`SELECT o.*,p."title",p."brand",p."basePrice",p."purchasePrice",p."categoryKey",p."images",p."description",p."attributes"
        FROM public."ChannelOffer" o JOIN public."CatalogProductRead" p ON p."id"=o."productId" AND p."organizationId"=o."organizationId"
        WHERE o."organizationId"=${org} AND o."connectionId"=${id} AND o."isActive"=true ORDER BY o."sellerSku"`;
      const mappings = await tx`SELECT m."externalId",m."warehouseId" FROM public."ChannelWarehouseMapping" m JOIN public."Warehouse" w
        ON w."id"=m."warehouseId" AND w."organizationId"=m."organizationId" WHERE m."organizationId"=${org} AND m."connectionId"=${id} AND w."isActive"=true`;
      if (!mappings.length) throw new RequestError("channel_warehouses_required", 409);
      if(action==="feed-preview")validateManifest(current.settings?.expectedSellerSkus,offers.map(o=>o.sellerSku));
      const allStocks=await tx`SELECT i."productId",i."warehouseId",i."onHand",i."reserved",i."safetyStock",i."revision"
        FROM public."Inventory" i JOIN public."ChannelOffer" o ON o."productId"=i."productId" AND o."organizationId"=${org}
          AND o."connectionId"=${id} AND o."isActive"=true
        JOIN public."ChannelWarehouseMapping" m ON m."warehouseId"=i."warehouseId" AND m."organizationId"=${org} AND m."connectionId"=${id}`;
      const allPolicies=await tx`SELECT * FROM public."ChannelRepricingPolicy" WHERE "organizationId"=${org}
        AND "channel"=${channelCode(current.adapter) || ""}`;
      const policiesByProduct=new Map(allPolicies.map(p=>[p.productId,financialPolicy(p)]));
      const stocksByProduct=new Map<string,Array<(typeof allStocks)[number]>>();
      for(const stock of allStocks){const group=stocksByProduct.get(stock.productId)||[];group.push(stock);stocksByProduct.set(stock.productId,group);}
      const snapshots = [];
      for (const offer of offers) {
        const price = offer.price ?? offer.basePrice;
        if (!Number.isSafeInteger(price) || price < 1) throw new RequestError("offer_price_required", 409);
        const policy=policiesByProduct.get(offer.productId) || null;
        if(channelCode(current.adapter)&&!policy)throw new RequestError("channel_financial_policy_required",409);
        assertFinancialPrice(price,offer.purchasePrice,policy);
        const stocks = stocksByProduct.get(offer.productId) || [];
        const availabilities = mappings.map(mapping => {
          const stock = stocks.find(s => s.warehouseId === mapping.warehouseId);
          return { storeId: mapping.externalId, stockCount: stock ? available(stock as { onHand: number; reserved: number; safetyStock: number },offer.channelBuffer) : 0,
            ...(offer.preorderDays ? { preorderDays: offer.preorderDays } : {}) };
        });
        snapshots.push({ sellerSku: offer.sellerSku, productId: offer.productId, title: offer.title, brand: offer.brand || "", price,
          availabilities, offerVersion: offer.version, inventoryRevisions: stocks.map(s => ({ warehouseId: s.warehouseId, revision: s.revision })) });
      }
      if (action === "feed-preview") {
        if (current.adapter !== "KASPI_XML") throw new RequestError("unsupported_operation", 422);
        const settings = current.settings || {};
        return kaspiFeed(settings.company || "", settings.merchantId || "", snapshots as FeedOffer[], settings.expectedSellerSkus);
      }
      if (!["OWN_STORE","GENERIC_ERP"].includes(current.adapter)) throw new RequestError("unsupported_operation", 422);
      return { schema: "catalog-hub/channel-export", version: 1, semantics:"SELECTED_OFFERS", connectionId: id, mode: current.mode, items: snapshots,
        deliveryStatus: "NOT_PUBLISHED" };
    }));
  }
  return json({ error: "unsupported_operation" }, 422);
}
