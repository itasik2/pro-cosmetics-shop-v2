import test from "node:test";
import assert from "node:assert/strict";
import { parseEnrichmentAction } from "./enrichment-actions";
import { hubBaseForPath } from "./api-routing";
import { isChangeSetId } from "./changeset-id";

test("action parser strips tenant and external search flags, defaults to filling gaps", () => {
  assert.deepEqual(parseEnrichmentAction({ action: "create", sku: " A001 ", organizationId: "another-org", allowExternalSearch: true }),
    { action: "create", sku: "A001", sourceUrl: undefined, supplierCode: undefined });
  assert.deepEqual(parseEnrichmentAction({ action: "stage", id: "proposal" }),
    { action: "stage", id: "proposal", selectedImageUrl: undefined, replaceFilledFields: false });
  assert.throws(() => parseEnrichmentAction({ action: "stage", id: "proposal", replaceFilledFields: "true" }));
  assert.throws(() => parseEnrichmentAction({ action: "create", sku: "A001", sourceUrl: "file:///etc/passwd" }));
});
test("isolated API routing keeps normal imports on Docker and uses Node for enrichment and its changesets", () => {
  const env = { CATALOG_HUB_LOCAL_MODE: "true", CATALOG_HUB_API_URL: "http://127.0.0.1:8000" };
  assert.equal(hubBaseForPath("/v1/catalog/products", env), "http://127.0.0.1:8000");
  assert.equal(hubBaseForPath("/v1/ai/enrichment/jobs?organizationId=org", env), "http://127.0.0.1:8001");
  assert.equal(hubBaseForPath("/v1/staging/changesets/cabcdefghijklmnopqrstuvwx/apply", env), "http://127.0.0.1:8001");
  assert.equal(hubBaseForPath("/v1/staging/changesets/12345678-1234-1234-1234-123456789abc/apply", env), "http://127.0.0.1:8000");
  assert.throws(() => hubBaseForPath("/v1/suppliers", { ...env, CATALOG_HUB_AI_API_URL: "https://production.example" }));
  assert.equal(hubBaseForPath("/v1/ai/enrichment/jobs", { CATALOG_HUB_API_URL: "https://api.example" }), "https://api.example");
});
test("changeset IDs allow both runtimes and reject path injection", () => {
  assert.equal(isChangeSetId("cabcdefghijklmnopqrstuvwx"), true);
  assert.equal(isChangeSetId("12345678-1234-1234-1234-123456789abc"), true);
  assert.equal(isChangeSetId("../another-org"), false);
});
