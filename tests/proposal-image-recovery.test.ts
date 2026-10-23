import assert from "node:assert/strict";
import test from "node:test";
import { recoverProposalImage, recoverablePhotoDownloadError, unavailableProposalPhotoMessage } from "../lib/enrichment/recoverProposalImage";
import { namePhotoKey } from "../lib/enrichment/photoIdentity";

const failed = "https://seller.example/old.jpg";
const replacement = "https://cdn.brand.example/bottle.png";
const page = "https://brand.example/product";
const product = { id: "p", name: "Осветляющий крем", brandId: "brand", brand: { name: "Brand" },
  supplierId: "supplier", supplier: { name: "Supplier" }, supplierSku: "SKY380", barcode: null,
  volumeValue: 50, volumeUnit: "ml", variants: [
    { id: "bottle", sku: "SKY380", label: "50 мл" }, { id: "sachet", sku: "SKY380/1", label: "3 мл" },
  ] };
const proposal = { product, facts: { variantImageCandidates: [
  { variantId: "bottle", sku: "SKY380", candidates: [{ url: failed, source: "WEB", sourceUrl: "https://seller.example/cream" }] },
  { variantId: "sachet", sku: "SKY380/1", candidates: [{ url: "https://cdn.brand.example/sachet.png", source: "WEB", sourceUrl: page }] },
] } };
const input = { productId: "p", supplierId: "supplier", proposalId: "proposal", sourceUrl: failed,
  policies: [{ domain: "brand.example", allowSubdomains: false }], officialDomains: ["brand.example"] };
const candidate = { url: replacement, source: "WEB" as const, sourceUrl: page,
  identityKey: namePhotoKey(product, product.variants[0]) };
const fetched = { buffer: Buffer.from("verified photo"), finalUrl: replacement, status: 200, contentType: "image/png", headers: {} };

function dependencies(options: { row?: unknown; sku?: string; candidates?: unknown[] } = {}) {
  let searches = 0, downloads = 0;
  return { calls: () => ({ searches, downloads }), services: {
    database: { productEnrichmentProposal: { findFirst: async ({ where }: any) => {
      assert.equal(where.status, "PENDING"); assert.equal(where.productId, "p");
      return options.row === undefined ? proposal : options.row;
    } } } as any,
    search: async (request: any) => {
      searches++;
      assert.equal(request.variant.sku, "SKY380"); assert.equal(request.variant.label, "50 мл");
      assert.equal(request.catalogOnly, true);
      assert.deepEqual(request.excludedUrls, ["https://seller.example/cream"]);
      assert.ok(request.knownUrls.includes(page));
      assert.ok(request.deadlineAt <= (input as any).deadlineAt || request.deadlineAt <= Date.now() + 60000);
      return { sku: options.sku || "SKY380", candidates: options.candidates || [candidate], status: "FOUND", issues: [] };
    },
    fetchImage: async (url: string, policies: any) => {
      downloads++; assert.equal(url, replacement);
      assert.ok(policies.some((policy: any) => policy.domain === "cdn.brand.example" && !policy.allowSubdomains));
      return fetched;
    },
  } as any };
}

test("a failed variant image is recovered using its exact SKU and volume, reusing the sibling's source page only", async () => {
  const deps = dependencies();
  assert.deepEqual(await recoverProposalImage(input, deps.services), fetched);
  assert.deepEqual(deps.calls(), { searches: 1, downloads: 1 });
});

test("recovery rejects another SKU, stale identity and reuse of the failed URL", async () => {
  for (const options of [ { sku: "SKY380/1" }, { candidates: [{ ...candidate, identityKey: "stale" }] },
    { candidates: [{ ...candidate, url: failed }] }, { candidates: [{ ...candidate, url: "https://127.0.0.1:444/photo.png" }] } ]) {
    const deps = dependencies(options);
    assert.equal(await recoverProposalImage(input, deps.services), null);
    assert.equal(deps.calls().downloads, 0);
  }
});

test("untrusted, changed, ambiguous and expired recovery targets never trigger downloads", async () => {
  for (const options of [ { row: null }, { row: { ...proposal, product: { ...product, supplierId: "other" } } },
    { row: { ...proposal, facts: { variantImageCandidates: [] } } },
    { row: { ...proposal, facts: { variantImageCandidates: proposal.facts.variantImageCandidates.map(group =>
      ({ ...group, candidates: [{ ...group.candidates[0], url: failed }] })) } } } ]) {
    const deps = dependencies(options);
    assert.equal(await recoverProposalImage(input, deps.services), null);
    assert.deepEqual(deps.calls(), { searches: 0, downloads: 0 });
  }
  const deps = dependencies();
  assert.equal(await recoverProposalImage({ ...input, deadlineAt: Date.now() - 1 }, deps.services), null);
  assert.deepEqual(deps.calls(), { searches: 0, downloads: 0 });
});

test("only unavailable-image errors permit alternate-source recovery; network policy failures do not", () => {
  for (const code of ["source_content_type_not_allowed:text/html", "source_http_404", "source_http_403", "source_http_410", "source_http_429", "source_http_503", "source_timeout"]) {
    assert.equal(recoverablePhotoDownloadError(new Error(code)), true);
    assert.match(unavailableProposalPhotoMessage(new Error(code))!, /Повторите подбор фото/);
  }
  for (const code of ["source_domain_not_allowed", "source_private_ip_not_allowed", "product_changed_refresh"]) {
    assert.equal(recoverablePhotoDownloadError(new Error(code)), false);
    assert.equal(unavailableProposalPhotoMessage(new Error(code)), null);
  }
});
