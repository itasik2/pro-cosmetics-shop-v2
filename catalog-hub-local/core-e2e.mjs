#!/usr/bin/env node
// Synthetic records only. This suite refuses remote API hosts.
import assert from "node:assert/strict";
import {runQueuedImportChecks} from "./import-queue-e2e.mjs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function coreFixtures(keyB, readOnlyKey) {
  const hash = key => createHash("sha256").update(key).digest("hex");
  return `
    INSERT INTO public."Organization" ("id","name","updatedAt") VALUES ('org_core_b','Synthetic tenant B',now()) ON CONFLICT ("id") DO NOTHING;
    UPDATE public."CatalogApiKey" SET "organizationId"='org_procosmetics',"scopes"='["*"]'::jsonb WHERE "id"='catalog-ubuntu-test';
    INSERT INTO public."CatalogApiKey" ("id","name","keyHash","organizationId","scopes") VALUES
      ('core-key-b','Synthetic B','${hash(keyB)}','org_core_b','["*"]'::jsonb),
      ('core-key-read','Synthetic reader','${hash(readOnlyKey)}','org_procosmetics','["catalog:read"]'::jsonb)
      ON CONFLICT ("id") DO UPDATE SET "keyHash"=EXCLUDED."keyHash","organizationId"=EXCLUDED."organizationId","scopes"=EXCLUDED."scopes";
    INSERT INTO public."Warehouse" ("id","organizationId","code","name","updatedAt") VALUES
      ('wh_core_second','org_procosmetics','CORE-2','Synthetic second warehouse',now()),
      ('wh_core_b','org_core_b','CORE-B','Synthetic B warehouse',now()) ON CONFLICT ("id") DO NOTHING;
    INSERT INTO public."Product" ("id","organizationId","sku","title","purchasePrice","basePrice","updatedAt")
      VALUES ('core-safety-product','org_procosmetics','CORE-SAFETY','Synthetic warehouse safety stock',100,200,now()) ON CONFLICT ("id") DO NOTHING;
    INSERT INTO public."Inventory" ("id","productId","warehouseId","onHand","reserved","safetyStock","updatedAt") VALUES
      ('core-safety-a','core-safety-product','wh_pav_01',0,0,5,now()),
      ('core-safety-b','core-safety-product','wh_core_second',5,0,0,now()) ON CONFLICT ("id") DO NOTHING;
    DO $guard$ DECLARE relation text; BEGIN
      FOREACH relation IN ARRAY ARRAY['ChannelConnection','ChannelOffer','ChannelWarehouseMapping','ChannelCategoryMapping',
        'CoreOrder','CoreOrderItem','StockMovement','CoreMutation','InboxEvent','OutboxEvent','ProductGrouping','CatalogImportRun','CatalogImportRow'] LOOP
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=format('public.%I',relation)::regclass)
          OR has_table_privilege('anon',format('public.%I',relation),'SELECT,INSERT,UPDATE,DELETE')
          OR has_table_privilege('authenticated',format('public.%I',relation),'SELECT,INSERT,UPDATE,DELETE') THEN
          RAISE EXCEPTION 'Unsafe Data API access: %',relation;
        END IF;
      END LOOP;
    END $guard$;
  `;
}

export async function runCoreChecks({ baseUrl = "http://127.0.0.1:8000", key, keyB, readOnlyKey }) {
  const target = new URL(baseUrl);
  assert.equal(target.hostname, "127.0.0.1", "Core tests may only use loopback");
  assert.equal(target.protocol, "http:");
  let checks = 0;
  const suffix = randomUUID().slice(0, 8);
  async function api(path, { body, credential = key, idempotencyKey, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(baseUrl + path, { method, signal:AbortSignal.timeout(15000), headers: {
      "x-catalog-hub-key": credential, ...(body ? { "content-type": "application/json", "idempotency-key": idempotencyKey || randomUUID() } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    return { status: response.status, data, requestId:response.headers.get("x-request-id") };
  }
  function expect(reply, status, message) {
    assert.equal(reply.status, status, message + ": " + JSON.stringify(reply.data)); checks++;
    return reply.data;
  }
  async function product(name, credential = key) {
    return expect(await api("/v1/catalog/products", { credential, body: { card: {
      sku: "CORE-" + name + "-" + suffix, title: "Synthetic " + name, brand: "Test", purchasePrice: 100, price: 200,
    } } }), 201, "create synthetic product");
  }
  async function channel(adapter = "OWN_STORE") {
    return expect(await api("/v1/channels", { body: { name: "Synthetic " + adapter + " " + suffix, adapter } }), 201, "create shadow connection");
  }
  async function activate(connection) {
    return expect(await api(`/v1/channels/${connection.id}/mode`, { body: { mode: "ACTIVE", expectedVersion: connection.version, confirmed: true } }), 200, "activate TEST connection");
  }
  async function stock(id, credential = key, warehouse = "wh_pav_01") {
    const data = expect(await api("/v1/inventory/balances?productId=" + id, { credential }), 200, "read balances");
    return data.items.find(i => i.warehouseId === warehouse) || { onHand: 0, reserved: 0, revision: 0 };
  }
  async function movement(id, kind, quantity, extra = {}, idempotencyKey) {
    const before = await stock(id);
    return api("/v1/inventory/movements", { idempotencyKey, body: { productId: id, warehouseId: "wh_pav_01", kind, quantity,
      expectedRevision: before.revision, reason: "Synthetic acceptance test", ...extra } });
  }
  const healthReply=await api("/health");
  const health = expect(healthReply, 200, "health contract");
  assert.equal(health.apiVersion, 1);
  assert.match(healthReply.requestId,/^[a-f0-9-]{36}$/);checks++;
  assert.equal(expect(await api("/ready"),200,"schema, constraint and API readiness").schemaReady,true);checks++;
  const safeAcrossWarehouses=expect(await api("/v1/catalog/products/core-safety-product"),200,"availability is clipped separately per warehouse");
  assert.equal(safeAcrossWarehouses.totals.available,5);checks++;
  expect(await api("/v1/catalog/products?organizationId=org_core_b"), 403, "cross-tenant query rejected");
  expect(await api("/v1/catalog/products?organizationId=org_procosmetics&organizationId=org_core_b"), 403, "duplicate tenant query rejected");
  expect(await api("/v1/catalog/products", { credential: "invalid-test-key" }), 401, "invalid credential rejected");
  expect(await api("/v1/catalog/products", { credential: readOnlyKey, body: { card: { sku: "READ", title: "Rejected" } } }), 403, "reader cannot write");
  expect(await api("/v1/catalog/products/bulk", { body: { items: [{ organizationId: "org_core_b", card: { sku: "BAD", title: "Rejected" } }] } }), 403, "nested tenant override rejected");
  const alien = await product("tenant-b", keyB);
  expect(await api("/v1/catalog/products/" + alien.id), 404, "direct foreign product ID rejected");
  expect(await movement(alien.id, "RECEIVE", 1), 404, "foreign product stock rejected");

  const ledger = await product("ledger");
  const warehouseKey=randomUUID(),warehouseBody={name:"Synthetic added warehouse",code:"ADDED-"+suffix};
  const newWarehouse=expect(await api("/v1/inventory/warehouses",{body:warehouseBody,idempotencyKey:warehouseKey}),201,"create warehouse through API");
  assert.equal(expect(await api("/v1/inventory/warehouses",{body:warehouseBody,idempotencyKey:warehouseKey}),201,"warehouse creation replay").id,newWarehouse.id);checks++;
  expect(await movement(ledger.id, "RECEIVE", 10), 201, "receive ten");
  expect(await movement(ledger.id, "WRITE_OFF", 2), 201, "write off two");
  assert.equal((await stock(ledger.id)).onHand, 8);
  const history = expect(await api("/v1/inventory/movements?productId=" + ledger.id), 200, "movement history");
  assert.equal(history.items.length, 2); checks++;
  const transferKey = randomUUID(), transferBody = { productId: ledger.id, warehouseId: "wh_pav_01", targetWarehouseId: "wh_core_second",
    kind: "TRANSFER", quantity: 3, expectedRevision: 2, targetExpectedRevision: 0, reason: "Synthetic warehouse transfer" };
  expect(await api("/v1/inventory/movements", { body: transferBody, idempotencyKey: transferKey }), 201, "atomic transfer");
  expect(await api("/v1/inventory/movements", { body: transferBody, idempotencyKey: transferKey }), 201, "idempotent transfer replay");
  assert.equal((await stock(ledger.id)).onHand, 5);
  assert.equal((await stock(ledger.id, key, "wh_core_second")).onHand, 3); checks++;
  expect(await api("/v1/inventory/movements", { body: { ...transferBody, quantity: 4 }, idempotencyKey: transferKey }), 409, "key reused with changed data rejected");
  expect(await movement(ledger.id, "RECEIVE", 1, { expectedRevision: 0 }), 409, "stale stock version rejected");
  expect(await movement(ledger.id, "TRANSFER", 1, { targetWarehouseId: "wh_core_b", targetExpectedRevision: 0 }), 404, "cross-tenant warehouse rejected");
  assert.equal((await stock(ledger.id)).onHand, 5); checks++;

  const connectionA = await activate(await channel()), connectionB = await activate(await channel());
  const last = await product("last-unit");
  expect(await movement(last.id, "RECEIVE", 1), 201, "receive last unit");
  const event = (connection, externalOrderId, type = "CREATED", items, externalEventId = randomUUID()) => ({
    connectionId: connection.id, externalOrderId, externalEventId, type,
    ...(items ? { items } : type === "CREATED" ? { items: [{ productId: last.id, warehouseId: "wh_pav_01", quantity: 1 }] } : {}),
  });
  const attemptA = event(connectionA, "last-a-" + suffix), attemptB = event(connectionB, "last-b-" + suffix);
  const race = await Promise.all([api("/v1/orders/events", { body: attemptA }), api("/v1/orders/events", { body: attemptB })]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]); checks++;
  assert.equal((await stock(last.id)).reserved, 1);
  const winner = race[0].status === 200 ? attemptA : attemptB, winningChannel = winner.connectionId === connectionA.id ? connectionA : connectionB;
  expect(await api("/v1/orders/events", { body: winner }), 200, "duplicate webhook with a new delivery key");
  assert.equal((await stock(last.id)).reserved, 1); checks++;
  expect(await api("/v1/orders/events", { body: event(winningChannel, winner.externalOrderId, "CANCELED") }), 200, "cancel releases reservation");
  assert.equal((await stock(last.id)).reserved, 0);
  const next = "next-" + suffix;
  expect(await api("/v1/orders/events", { body: event(connectionA, next) }), 200, "reserve released stock");
  const ship = event(connectionA, next, "SHIPPED");
  expect(await api("/v1/orders/events", { body: ship }), 200, "ship atomically");
  expect(await api("/v1/orders/events", { body: ship }), 200, "duplicate shipment");
  expect(await api("/v1/orders/events", { body: event(connectionA, next, "SHIPPED") }), 200, "repeated shipped status");
  assert.equal((await stock(last.id)).onHand, 0);
  assert.equal((await stock(last.id)).reserved, 0); checks++;
  expect(await api("/v1/orders/events", { body: event(connectionA, next, "CANCELED") }), 409, "shipped order cannot cancel reservation");
  const returned = event(connectionA, next, "RETURNED");
  expect(await api("/v1/orders/events", { body: returned }), 200, "return restores physical stock");
  expect(await api("/v1/orders/events", { body: returned }), 200, "duplicate return");
  assert.equal((await stock(last.id)).onHand, 1); checks++;

  const partial=await product("partial-return");
  expect(await movement(partial.id,"RECEIVE",3),201,"receive partial-return stock");
  const partialId="partial-"+suffix;
  expect(await api("/v1/orders/events",{body:event(connectionA,partialId,"CREATED",[{productId:partial.id,warehouseId:"wh_pav_01",quantity:3}])}),200,"reserve three units");
  expect(await api("/v1/orders/events",{body:event(connectionA,partialId,"SHIPPED")}),200,"ship three units");
  expect(await api("/v1/orders/events",{body:event(connectionA,partialId,"RETURNED",[{productId:partial.id,warehouseId:"wh_pav_01",quantity:1}])}),200,"partial return one");
  assert.equal((await stock(partial.id)).onHand,1);checks++;
  expect(await api("/v1/orders/events",{body:event(connectionA,partialId,"RETURNED",[{productId:partial.id,warehouseId:"wh_pav_01",quantity:3}])}),409,"over-return rejected");
  expect(await api("/v1/orders/events",{body:event(connectionA,partialId,"RETURNED",[{productId:partial.id,warehouseId:"wh_pav_01",quantity:2}])}),200,"return remaining two");
  assert.equal((await stock(partial.id)).onHand,3);checks++;

  const shortage = await product("shortage");
  const atomic = event(connectionA, "atomic-" + suffix, "CREATED", [
    { productId: ledger.id, warehouseId: "wh_pav_01", quantity: 1 },
    { productId: shortage.id, warehouseId: "wh_pav_01", quantity: 1 },
  ]);
  expect(await api("/v1/orders/events", { body: atomic }), 409, "partial multi-item reservation rolls back");
  assert.equal((await stock(ledger.id)).reserved, 0); checks++;
  const shadow = await channel();
  expect(await api("/v1/orders/events", { body: event(shadow, "shadow-" + suffix) }), 409, "shadow cannot change stock");
  expect(await api("/v1/orders/events/preview", { body: event(shadow, "shadow-" + suffix) }), 200, "shadow preview is read-only");
  assert.equal((await stock(last.id)).reserved, 0); checks++;

  const feed = await channel("KASPI_XML");
  const settings = { expectedVersion: 1, warehouses: [{ warehouseId: "wh_pav_01", externalId: "PP1" }],
    settings: { company: "Synthetic & Company", merchantId: "TESTMERCHANT", expectedSellerSkus: ["FEED1", "FEED2"] } };
  expect(await api(`/v1/channels/${feed.id}/mappings`, { body: settings }), 200, "map feed warehouse and expected SKU set");
  expect(await api(`/v1/channels/${feed.id}/offers`, { body: { productId: ledger.id, sellerSku: "FEED1", expectedVersion: 0 } }), 200, "first feed offer");
  expect(await api(`/v1/channels/${feed.id}/feed-preview`), 409, "incomplete XML blocked");
  expect(await api(`/v1/channels/${feed.id}/offers`, { body: { productId: last.id, sellerSku: "FEED2", expectedVersion: 0 } }), 200, "second feed offer");
  expect(await api(`/v1/channels/${feed.id}/feed-preview`),409,"publication preview requires financial policy");
  const policy=(productId,minPrice=150)=>({productId,channel:"KASPI",strategy:"UNDERCUT",mode:"DRY_RUN",enabled:false,emergencyStop:true,
    currentOfferPrice:200,minPrice,maxPrice:500,minMarginPercent:10,feePercent:10,shippingCost:0,targetProfit:0,
    step:10,adjustment:10,maxChangePercent:5,maxAgeMinutes:60,cooldownMinutes:60});
  expect(await api("/v1/repricing/policies",{body:policy(ledger.id)}),201,"create margin policy for feed product");
  expect(await api("/v1/repricing/policies",{body:policy(last.id)}),201,"create second margin policy");
  expect(await api(`/v1/channels/${feed.id}/offers`,{body:{productId:ledger.id,sellerSku:"FEED1",price:140,expectedVersion:1}}),409,"manual offer cannot bypass financial floor");
  const fullFeed = expect(await api(`/v1/channels/${feed.id}/feed-preview`), 200, "complete XML preview");
  assert.equal(fullFeed.count, 2);
  assert.equal(fullFeed.deliveryStatus, "NOT_PUBLISHED");
  assert.match(fullFeed.xml, /Synthetic &amp; Company/);
  assert.doesNotMatch(fullFeed.xml, /purchasePrice|onHand|organizationId/); checks++;
  expect(await api("/v1/repricing/policies",{body:policy(ledger.id,210)}),201,"raise floor after offer was saved");
  expect(await api(`/v1/channels/${feed.id}/feed-preview`),409,"feed rechecks the current financial policy");

  // Real SKU identities, commercial values and stock survive shared-card grouping.
  const variants=[];
  for(const [index,volume] of [30,210,1000].entries()) {
    const created=await product("variant-"+volume);
    const saved=expect(await api("/v1/catalog/manual-save",{body:{productId:created.id,expectedUpdatedAt:created.updatedAt,
      proposed:{title:"Synthetic shared cream "+volume+" g",description:"Verified copy "+volume,
        images:["https://example.invalid/variant-"+volume+".jpg"],attributes:{volumeValue:volume,volumeUnit:"g"}}}}),200,"prepare independent variant identity");
    variants.push(expect(await api("/v1/catalog/products/"+saved.id),200,"read prepared variant"));
    expect(await movement(created.id,"RECEIVE",index+2),201,"independent variant stock");
  }
  const groupInput={productIds:variants.map(v=>v.id),masterProductId:variants[0].id,title:"Synthetic shared cream",reason:"Synthetic verified identity"};
  expect(await api("/v1/catalog/variants/preview",{credential:readOnlyKey,body:groupInput}),403,"reader cannot prepare a grouping");
  expect(await api("/v1/catalog/variants/preview",{credential:keyB,body:groupInput}),404,"other tenant cannot inspect variants");
  const staleGroup=expect(await api("/v1/catalog/variants/preview",{body:groupInput}),200,"group preview makes no changes");
  expect(await api("/v1/catalog/manual-save",{body:{productId:variants[2].id,expectedUpdatedAt:variants[2].updatedAt,proposed:{description:"New verified copy"}}}),200,"change one previewed member");
  expect(await api("/v1/catalog/variants/apply",{body:{...groupInput,fingerprint:staleGroup.fingerprint,confirmed:true,conflictsAcknowledged:true}}),409,"stale group blocked atomically");
  let groupPreview=expect(await api("/v1/catalog/variants/preview",{body:groupInput}),200,"fresh grouping preview");
  const groupKey=randomUUID(),groupBody={...groupInput,fingerprint:groupPreview.fingerprint,confirmed:true,conflictsAcknowledged:true};
  const group=expect(await api("/v1/catalog/variants/apply",{body:groupBody,idempotencyKey:groupKey}),200,"apply shared card");
  assert.equal(expect(await api("/v1/catalog/variants/apply",{body:groupBody,idempotencyKey:groupKey}),200,"grouping replay").groupingId,group.groupingId);checks++;
  const member=expect(await api("/v1/catalog/products/"+variants[1].id),200,"member inherits shared title");
  assert.equal(member.title,groupInput.title);assert.equal(member.description,variants[0].description);
  assert.equal(member.sku,variants[1].sku);assert.deepEqual(member.images,variants[1].images);
  assert.deepEqual(member.attributes,variants[1].attributes);assert.equal(member.price,variants[1].price);checks++;
  assert.equal((await stock(member.id)).onHand,3);checks++;
  expect(await api("/v1/catalog/manual-save",{body:{productId:member.id,expectedUpdatedAt:member.updatedAt,proposed:{title:"Second hidden master"}}}),409,"member common fields cannot diverge");
  const groupedSearch=expect(await api("/v1/catalog/products?cards=true&q="+variants[1].sku),200,"member SKU finds single master card");
  assert.equal(groupedSearch.items.length,1);assert.equal(groupedSearch.items[0].id,groupInput.masterProductId);
  assert.equal(groupedSearch.items[0].variantSummary.count,3);assert.equal(groupedSearch.items[0].variantSummary.available,9);checks++;
  const groupedSnapshot=expect(await api("/v1/catalog/snapshot"),200,"import snapshot retains all variants");
  assert.equal(groupedSnapshot.items.find(v=>v.id===member.id).title,groupInput.title);checks++;
  expect(await movement(member.id,"RECEIVE",1),201,"stock movement after grouping");
  const undoKey=randomUUID(),undoPath="/v1/catalog/variants/groupings/"+group.groupingId+"/undo";
  expect(await api(undoPath,{body:{confirmed:true},idempotencyKey:undoKey}),200,"undo grouping without undoing stock changes");
  expect(await api(undoPath,{body:{confirmed:true},idempotencyKey:undoKey}),200,"undo replay");
  const restored=expect(await api("/v1/catalog/products/"+member.id),200,"restored original card");
  assert.equal(restored.masterProductId,null);assert.equal(restored.title,variants[1].title);assert.deepEqual(restored.images,variants[1].images);checks++;
  assert.equal((await stock(member.id)).onHand,4);checks++;
  groupPreview=expect(await api("/v1/catalog/variants/preview",{body:groupInput}),200,"regroup after undo");
  const secondGroup=expect(await api("/v1/catalog/variants/apply",{body:{...groupInput,fingerprint:groupPreview.fingerprint,confirmed:true,conflictsAcknowledged:true}}),200,"second grouping");
  const sharedMaster=expect(await api("/v1/catalog/products/"+variants[0].id),200,"current shared master");
  expect(await api("/v1/catalog/manual-save",{body:{productId:sharedMaster.id,expectedUpdatedAt:sharedMaster.updatedAt,proposed:{description:"Updated shared text"}}}),200,"edit single shared description");
  assert.equal(expect(await api("/v1/catalog/products/"+member.id),200,"member reads current common copy").description,"Updated shared text");checks++;
  expect(await api("/v1/catalog/variants/groupings/"+secondGroup.groupingId+"/undo",{body:{confirmed:true}}),409,"undo detects later common edits");
  assert.equal(expect(await api("/v1/catalog/variants/"+member.id),200,"variant family is visible from member").variants.length,3);checks++;

  checks+=(await runQueuedImportChecks({baseUrl,key,keyB,readOnlyKey,workerCycle:(await import("../marketplace-hub/dist/worker/catalog-import-worker.js")).importWorkerCycle})).checks;

  const claimed = expect(await api("/v1/sync/outbox/claim", { body: { limit: 2 } }), 200, "claim durable outbox");
  assert.equal(claimed.events.length, 2);
  const first = claimed.events[0];
  expect(await api(`/v1/sync/outbox/${first.id}/ack`, { body: { leaseToken: "invalid" } }), 409, "wrong lease rejected");
  expect(await api(`/v1/sync/outbox/${first.id}/ack`, { body: { leaseToken: first.leaseToken } }), 200, "ack claimed event");
  const second = claimed.events[1];
  expect(await api(`/v1/sync/outbox/${second.id}/fail`, { body: { leaseToken: second.leaseToken, errorCode: "PROVIDER_TIMEOUT" } }), 200, "retry after failure");
  console.log(`Catalog Core: ${checks} synthetic API checks passed.`);
  return { checks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = dirname(fileURLToPath(import.meta.url));
  const { key } = JSON.parse(readFileSync(resolve(base, ".test-credentials.json"), "utf8"));
  const keyB = randomBytes(32).toString("hex"), readOnlyKey = randomBytes(32).toString("hex");
  const seeded = spawnSync("docker", ["compose", "-f", resolve(base,"compose.yaml"), "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1",
    "-U", "catalog_test", "-d", "catalog_test"], { input: coreFixtures(keyB,readOnlyKey), encoding: "utf8" });
  if (seeded.status !== 0) throw new Error("Synthetic tenant fixtures failed: " + seeded.stderr);
  await runCoreChecks({ key, keyB, readOnlyKey });
}
