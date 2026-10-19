// Deterministic localhost-only enrichment flow: no paid AI calls or external requests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = Object.fromEntries(readFileSync(resolve(root, "catalog-hub-web/.env.local"), "utf8").split(/\r?\n/)
  .filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
assert.equal(cfg.CATALOG_HUB_API_URL, "http://127.0.0.1:8000", "Refusing non-local backend");
assert.equal(cfg.CATALOG_HUB_LOCAL_MODE, "true");
assert.equal(cfg.CATALOG_HUB_LOCAL_WRITE_ENABLED, "true");
const ui = "http://127.0.0.1:3001", ai = "http://127.0.0.1:8001", api = "http://127.0.0.1:8000";
const org = "org_procosmetics";
async function request(url, options = {}, expected = 200) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000), redirect: "manual" });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, expected, JSON.stringify(data));
  return { response, data };
}
const session = await request(ui + "/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: cfg.CATALOG_HUB_UI_PASSWORD }) });
const cookie = session.response.headers.get("set-cookie").split(";")[0];
const headers = { cookie, origin: ui, "content-type": "application/json" };
const apiHeaders = { "x-catalog-hub-key": cfg.CATALOG_HUB_API_KEY };
async function action(body, expected = 200) {
  return (await request(ui + "/api/ai/enrichment", { method: "POST", headers, body: JSON.stringify(body) }, expected)).data;
}
await request(ai + "/v1/ai/enrichment/jobs?organizationId=" + org, {}, 401);
const sku = "TEST-ENRICH-" + randomBytes(4).toString("hex").toUpperCase();
const product = (await request(api + "/v1/catalog/products", { method: "POST", headers: { ...apiHeaders, "content-type": "application/json" }, body: JSON.stringify({
  organizationId: org, card: { sku, title: "Synthetic cream 50 ml", brand: "Demo", description: "Reviewed supplier description", price: 1500, purchasePrice: 1000,
    attributes: { volumeValue: 50, volumeUnit: "ml" } },
}) }, 201)).data;
await action({ action: "source", supplierCode: "TEST-ENRICH", name: "Synthetic supplier", sourceUrl: "https://fixture.example", sourceType: "OFFICIAL_SITE" });
// Operator-supplied public URLs are allowed; private IPs must be rejected
// before any network request, keeping this test strictly local.
const job = await action({ action: "create", sku, supplierCode: "TEST-ENRICH", sourceUrl: "https://127.0.0.1/product" });
assert.equal(job.status, "PENDING");
const list = (await request(ai + "/v1/ai/enrichment/jobs?organizationId=" + org, { headers: apiHeaders })).data;
assert.ok(list.some(item => item.id === job.id));
const foreign = (await request(ai + "/v1/ai/enrichment/jobs?organizationId=unrelated-org", { headers: apiHeaders })).data;
assert.equal(foreign.some(item => item.id === job.id), false);
const failure = await action({ action: "run", id: job.id }, 400);
assert.equal(failure.error, "source_ip_blocked");
const failedJob = (await request(ai + "/v1/ai/enrichment/jobs/" + job.id + "?organizationId=" + org, { headers: apiHeaders })).data;
assert.equal(failedJob.status, "FAILED");
assert.equal(failedJob.attempt, 1);

// Seed an extracted proposal to verify review/apply without network or model calls.
const proposalId = "synthetic-" + randomBytes(5).toString("hex");
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sql = `INSERT INTO public."CatalogEnrichmentProposal"
 ("id","productId","sourceUrl","confidence","description","application","ingredients","images","facts","warnings","status","createdAt","updatedAt") VALUES
 (${quote(proposalId)},${quote(product.id)},'https://fixture.example/cream',97,'AI must not overwrite reviewed copy','Apply daily','Aqua, Glycerin',
 '["https://fixture.example/cream.jpg"]'::jsonb,'{"extracted":{"brand":"Demo"}}'::jsonb,'[]'::jsonb,'PENDING',now(),now());`;
const seed = spawnSync("docker", ["compose", "-f", resolve(root, "catalog-hub-local/compose.yaml"), "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "catalog_test", "-d", "catalog_test"], { input: sql, encoding: "utf8" });
assert.equal(seed.status, 0, seed.stderr);
const changes = await action({ action: "stage", id: proposalId, selectedImageUrl: "https://fixture.example/cream.jpg" });
assert.match(changes.id, /^c[a-z0-9]{24}$/);
assert.deepEqual(changes.fields.map(field => field.field).sort(), ["application", "images", "ingredients"]);
const repeated = await action({ action: "stage", id: proposalId, selectedImageUrl: "https://fixture.example/cream.jpg" });
assert.equal(repeated.id, changes.id, "Repeated staging must return the same changeset");
const page = await fetch(ui + "/changes/" + changes.id, { headers: { cookie } });
assert.equal(page.status, 200);
assert.ok((await page.text()).includes("Проверка изменений"));
async function snapshot() {
  return (await request(api + "/v1/catalog/snapshot?organizationId=" + org, { headers: apiHeaders })).data.items.find(item => item.sku === sku);
}
assert.equal((await snapshot()).ingredients, null, "Staging must not edit product");
const changeAction = async body => request(ui + "/api/catalog/changes/" + changes.id, { method: "POST", headers, body: JSON.stringify(body) });
await changeAction({ action: "approve", approvedFields: ["application", "images"] });
await changeAction({ action: "apply" });
const remaining = await action({ action: "stage", id: proposalId, selectedImageUrl: "https://fixture.example/cream.jpg" });
assert.notEqual(remaining.id, changes.id, "Partial application must allow a new review");
assert.deepEqual(remaining.fields.map(field => field.field), ["ingredients"]);
await request(ui + "/api/catalog/changes/" + remaining.id, { method: "POST", headers,
  body: JSON.stringify({ action: "approve", approvedFields: ["ingredients"] }) });
await request(ui + "/api/catalog/changes/" + remaining.id, { method: "POST", headers,
  body: JSON.stringify({ action: "apply" }) });
const after = await snapshot();
assert.equal(after.description, "Reviewed supplier description");
assert.equal(after.ingredients, "Aqua, Glycerin");
assert.equal(after.application, "Apply daily");
assert.equal(after.price, 1500);
assert.equal(after.purchasePrice, 1000);
assert.equal(after.stock, 0);
assert.deepEqual(after.images, ["https://fixture.example/cream.jpg"]);
const proposals = (await request(ai + "/v1/ai/enrichment/proposals?organizationId=" + org, { headers: apiHeaders })).data;
assert.equal(proposals.find(p => p.id === proposalId)?.status, "APPLIED");
console.log("PASS: source configuration, tenant-scoped queue, failed job audit, fill-only staging, image selection, review page, partial restaging, approve/apply, unchanged prices and stock.");
