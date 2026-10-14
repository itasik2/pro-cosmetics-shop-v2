import assert from "node:assert/strict";
import test from "node:test";
import { discoverProductSource } from "./discovery.js";
import { requestStructured } from "./openai.js";
import { safeFetchExternal } from "./network.js";

const found = {
  found: true,
  url: "https://example.com/product",
  confidence: 90,
  reason: "SKU match",
};
const notFound = {
  found: false,
  url: null,
  confidence: 0,
  reason: "not found",
};
const timeout = async () => {
  throw new Error("openai_timeout");
};

test("official timeout falls back only when external search is enabled", async () => {
  const result = await discoverProductSource({
    hasOfficialSources: true,
    allowExternalSearch: true,
    official: timeout,
    external: async () => found,
  });
  assert.equal(result?.url, found.url);
  assert.equal(result?.search.stage, "external");
  assert.equal(result?.search.officialFailure, "openai_timeout");
  await assert.rejects(
    discoverProductSource({
      hasOfficialSources: true,
      allowExternalSearch: false,
      official: timeout,
      external: async () => {
        assert.fail("external search is disabled");
      },
    }),
    /openai_timeout/,
  );
});

test("incomplete searches stay errors and credentials are not retried", async () => {
  await assert.rejects(
    discoverProductSource({
      hasOfficialSources: true,
      allowExternalSearch: true,
      official: timeout,
      external: async () => notFound,
    }),
    /openai_search_incomplete/,
  );
  await assert.rejects(
    discoverProductSource({
      hasOfficialSources: true,
      allowExternalSearch: true,
      official: async () => {
        throw new Error("openai_http_401:unauthorized");
      },
      external: async () => {
        assert.fail("must not retry a credential error");
      },
    }),
    /openai_http_401/,
  );
});

test("an official match skips external search and missing policies respect the opt-in", async () => {
  const result = await discoverProductSource({
    hasOfficialSources: true,
    allowExternalSearch: true,
    official: async () => found,
    external: async () => {
      assert.fail("already found");
    },
  });
  assert.equal(result?.search.stage, "official");
  assert.equal(
    await discoverProductSource({
      hasOfficialSources: false,
      allowExternalSearch: false,
      official: async () => {
        assert.fail("no official source policy");
      },
      external: async () => {
        assert.fail("external search disabled");
      },
    }),
    null,
  );
});

test("a brand-discovered official page is kept unverified for review", async () => {
  const result = await discoverProductSource({
    hasOfficialSources: false, allowExternalSearch: false,
    official: async () => { assert.fail("no configured official domains"); },
    unconfiguredOfficial: async () => ({ found: true,
      url: "https://brand.example/product", domain: "brand.example",
      confidence: 80, reason: "Brand site" }),
    external: async () => { assert.fail("external search disabled"); },
  });
  assert.equal(result?.search.stage, "official_unverified");
  assert.equal(result?.officialDomain, "brand.example");
});

test("search requires completed web search and limits reasoning, output and tool calls", async () => {
  const previous = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_ENRICHMENT_MODEL;
  process.env.OPENAI_API_KEY = "test-only";
  process.env.OPENAI_ENRICHMENT_MODEL = "gpt-6-luna";
  try {
    const input = {
      schemaName: "test",
      schema: { type: "object" },
      system: "test",
      user: "test",
      profile: "search" as const,
      tools: [{ type: "web_search" }],
    };
    assert.deepEqual(
      await requestStructured(input, async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        assert.equal(body.model, "gpt-6-luna");
        assert.equal(body.reasoning.effort, "low");
        assert.equal(body.max_output_tokens, 3000);
        assert.equal(body.max_tool_calls, 3);
        assert.equal(body.tool_choice, "required");
        assert.equal(body.store, false);
        return Response.json({
          status: "completed",
          output: [{ type: "web_search_call", status: "completed" }],
          output_text: '{"ok":true}',
        });
      }),
      { ok: true },
    );
    await assert.rejects(
      requestStructured(input, async () =>
        Response.json({ output_text: "{}" }),
      ),
      /openai_search_not_run/,
    );
    await assert.rejects(
      requestStructured(input, async () =>
        Response.json({ status: "incomplete", output_text: "{}" }),
      ),
      /openai_incomplete_output/,
    );
    await requestStructured(
      { ...input, profile: "copy", tools: [] },
      async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        assert.equal(body.reasoning.effort, "none");
        assert.equal(body.max_output_tokens, 2500);
        assert.equal(body.max_tool_calls, undefined);
        return Response.json({ output_text: "{}" });
      },
    );
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    if (previousModel === undefined) delete process.env.OPENAI_ENRICHMENT_MODEL;
    else process.env.OPENAI_ENRICHMENT_MODEL = previousModel;
  }
});

const options = {
  policies: [{ domain: "example.com", allowSubdomains: false }],
  maxBytes: 100,
  acceptedContentTypes: ["text/html"],
  timeoutMs: 1000,
};
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

test("source deadline includes DNS lookup", async () => {
  await assert.rejects(
    safeFetchExternal("https://example.com/product", options, {
      resolveHostname: () => new Promise(() => {}),
      fetcher: async () => {
        assert.fail("DNS did not finish");
      },
    }),
    /source_timeout/,
  );
});

test("source deadline includes streaming body after response headers", async () => {
  let cancelled = false;
  await assert.rejects(
    safeFetchExternal("https://example.com/product", options, {
      resolveHostname: publicDns,
      fetcher: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([65]));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
    }),
    /source_timeout/,
  );
  assert.ok(cancelled);
});

test("redirects share a single deadline and private DNS remains blocked", async () => {
  let calls = 0;
  await assert.rejects(
    safeFetchExternal("https://example.com/product", options, {
      resolveHostname: publicDns,
      fetcher: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 600));
        return new Response(null, {
          status: 302,
          headers: { location: "/next" },
        });
      },
    }),
    /source_timeout/,
  );
  assert.equal(calls, 2);
  await assert.rejects(
    safeFetchExternal("https://example.com/product", options, {
      resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
      fetcher: async () => {
        assert.fail("must not fetch private IP");
      },
    }),
    /source_dns_blocked/,
  );
});
