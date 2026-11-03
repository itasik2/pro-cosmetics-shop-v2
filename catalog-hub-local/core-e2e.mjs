#!/usr/bin/env node
// Synthetic records only. This suite refuses remote API hosts.
import assert from "node:assert/strict";
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
  `;
}

export async function runCoreChecks({ baseUrl = "http://127.0.0.1:8000", key, keyB, readOnlyKey }) {
  const target = new URL(baseUrl);
  assert.equal(target.hostname, "127.0.0.1", "Core tests may only use loopback");
  assert.equal(target.protocol, "http:");
  let checks = 0;
  const suffix = randomUUID().slice(0, 8);
  async function api(path, { body, credential = key, idempotencyKey, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(baseUrl + path, { method, headers: {
      "x-catalog-hub-key": credential, ...(body ? { "content-type": "application/json", "idempotency-key": idempotencyKey || randomUUID() } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    return { status: response.status, data };
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
  const health = expect(await api("/health"), 200, "health contract");
  assert.equal(health.apiVersion, 1);
  expect(await api("/v1/catalog/products?organizationId=org_core_b"), 403, "cross-tenant query rejected");
  expect(await api("/v1/catalog/products?organizationId=org_procosmetics&organizationId=org_core_b"), 403, "duplicate tenant query rejected");
  expect(await api("/v1/catalog/products", { credential: "invalid-test-key" }), 401, "invalid credential rejected");
  expect(await api("/v1/catalog/products", { credential: readOnlyKey, body: { card: { sku: "READ", title: "Rejected" } } }), 403, "reader cannot write");
  expect(await api("/v1/catalog/products/bulk", { body: { items: [{ organizationId: "org_core_b", card: { sku: "BAD", title: "Rejected" } }] } }), 403, "nested tenant override rejected");
  const alien = await product("tenant-b", keyB);
  expect(await api("/v1/catalog/products/" + alien.id), 404, "direct foreign product ID rejected");
  expect(await movement(alien.id, "RECEIVE", 1), 404, "foreign product stock rejected");

  const ledger = await product("ledger");
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
  const fullFeed = expect(await api(`/v1/channels/${feed.id}/feed-preview`), 200, "complete XML preview");
  assert.equal(fullFeed.count, 2);
  assert.equal(fullFeed.deliveryStatus, "NOT_PUBLISHED");
  assert.match(fullFeed.xml, /Synthetic &amp; Company/);
  assert.doesNotMatch(fullFeed.xml, /purchasePrice|onHand|organizationId/); checks++;

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
