import assert from "node:assert/strict";
import test from "node:test";
import { pinnedSourceLookup, safeFetchExternal } from "./network";

const options = {
  policies: [{ domain: "brand.example", allowSubdomains: true }],
  maxBytes: 1024,
  acceptedContentTypes: ["text/html"],
};

test("connection lookup uses the validated address even if DNS changes", async () => {
  const pinned = { address: "93.184.216.34", family: 4 };
  const lookup = pinnedSourceLookup(pinned);
  const single = await new Promise((resolve) => lookup("brand.example", {}, (_error, address, family) =>
    resolve({ address, family })));
  const all = await new Promise((resolve) => lookup("brand.example", { all: true }, (_error, address) =>
    resolve(address)));
  assert.deepEqual(single, pinned);
  assert.deepEqual(all, [pinned]);
});

test("private DNS answers and redirects outside the source domain are refused", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, {
    status: 302, headers: { location: "http://127.0.0.1/private" },
  }); };
  await assert.rejects(safeFetchExternal("https://brand.example/product", options, {
    fetcher, resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
  }), /source_dns_blocked/);
  assert.equal(calls, 0);
  await assert.rejects(safeFetchExternal("https://brand.example/product", options, {
    fetcher, resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
  }), /source_domain_not_allowed/);
  assert.equal(calls, 1);
});
