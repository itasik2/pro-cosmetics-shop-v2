import test from "node:test";
import assert from "node:assert/strict";
import { assertScope, boundedJson, legacyOrganization, scopeRequest } from "../../marketplace-hub/supabase/functions/catalog-hub/request-context";

const principal = { actor: "key:test", organizationId: "org_a", scopes: ["catalog:read"] };
test("organization comes from the principal even when caller omits it", async () => {
  const url = new URL("https://example.test/v1/catalog/products");
  await scopeRequest(new Request(url), url, principal);
  assert.equal(url.searchParams.get("organizationId"), "org_a");
});
test("rejects another tenant in GET, repeated query parameters, body and bulk item", async () => {
  for (const query of ["?organizationId=org_b", "?organizationId=org_a&organizationId=org_b"]) {
    const url = new URL("https://example.test/v1/catalog/products" + query);
    await assert.rejects(scopeRequest(new Request(url), url, principal), /organization_forbidden/);
  }
  for (const body of [{ organizationId: "org_b" }, { items: [{ organizationId: "org_b" }] }]) {
    const req = new Request("https://example.test/v1/catalog/products", { method: "POST", body: JSON.stringify(body) });
    await assert.rejects(scopeRequest(req, new URL(req.url), principal), /organization_forbidden/);
  }
});
test("bulk creation receives the authenticated organization on every item", async () => {
  const req = new Request("https://example.test", { method: "POST", body: JSON.stringify({ items: [{ card: { sku: "A" } }] }) });
  const scoped = await scopeRequest(req, new URL(req.url), principal);
  assert.deepEqual(await scoped.json(), { organizationId: "org_a", items: [{ organizationId: "org_a", card: { sku: "A" } }] });
});
test("read credentials cannot write, unknown routes fail closed", () => {
  assert.doesNotThrow(() => assertScope(principal, "/v1/catalog/products", "GET"));
  assert.throws(() => assertScope(principal, "/v1/catalog/products", "POST"), /scope_forbidden/);
  assert.throws(() => assertScope({ ...principal, scopes: ["*"] }, "/v1/new-admin", "POST"), /scope_forbidden/);
});
test("unbound legacy credentials fail closed as soon as there are two organizations", () => {
  assert.equal(legacyOrganization(["org_a"]), "org_a");
  assert.equal(legacyOrganization(["org_a", "org_b"]), null);
  assert.equal(legacyOrganization([]), null);
});
test("chunked body is bounded without trusting Content-Length", async () => {
  const req = new Request("https://example.test", { method: "POST", body: JSON.stringify({ data: "x".repeat(100) }) });
  await assert.rejects(boundedJson(req, 20), /payload_too_large/);
});

test("a channel-bound event credential cannot send to another channel or the generic order endpoint",()=>{
 const credential={...principal,scopes:["orders:write:store_a"]};
 assert.doesNotThrow(()=>assertScope(credential,"/v1/channels/store_a/order-events","POST"));
 assert.throws(()=>assertScope(credential,"/v1/channels/store_b/order-events","POST"),/scope_forbidden/);
 assert.throws(()=>assertScope(credential,"/v1/orders/events","POST"),/scope_forbidden/);
 assert.doesNotThrow(()=>assertScope({...principal,scopes:["channels:read"]},"/v1/channels/store_a/shadow-preview","POST"));
});
