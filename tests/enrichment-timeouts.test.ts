import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverWithFallback,
  remainingTime,
} from "../lib/enrichment/timeBudget";
import {
  canRetryEnrichment,
  enrichmentFailureMessage,
} from "../lib/enrichment/clientMessages";
import { requestStructured } from "../lib/enrichment/openaiResponses";
import { safeFetchExternal } from "../lib/enrichment/network";

const notFound = {
  found: false,
  url: null,
  confidence: 0,
  reason: "not found",
};
const found = {
  found: true,
  url: "https://example.com/product",
  confidence: 90,
  reason: "SKU match",
};

test("official search timeout continues to external sources and records the failed stage", async () => {
  let externalCalls = 0;
  const result = await discoverWithFallback(
    async () => {
      throw new Error("openai_timeout");
    },
    async () => {
      externalCalls++;
      return found;
    },
  );
  assert.equal(result.url, found.url);
  assert.equal(result.result.searchStage, "external");
  assert.equal(externalCalls, 1);
  assert.equal(
    "officialResult" in result.result && result.result.officialResult?.reason,
    "openai_timeout",
  );
});

test("timeouts are not reported as absence and credential errors are not retried elsewhere", async () => {
  await assert.rejects(
    discoverWithFallback(
      async () => {
        throw new Error("openai_timeout");
      },
      async () => notFound,
    ),
    /openai_search_incomplete/,
  );
  await assert.rejects(
    discoverWithFallback(
      async () => {
        throw new Error("openai_http_403:forbidden");
      },
      async () => {
        assert.fail("must not repeat a credential failure");
      },
    ),
    /openai_http_403/,
  );
  const result = await discoverWithFallback(
    async () => found,
    async () => {
      assert.fail("official source already found");
    },
  );
  assert.equal(result.result.searchStage, "official");
});

test("stage budgets use remaining time and cannot restart an expired job", () => {
  assert.equal(remainingTime(150000, 40000, 10000), 40000);
  assert.equal(remainingTime(150000, 40000, 135000), 15000);
  assert.throws(
    () => remainingTime(150000, 40000, 149001),
    /enrichment_timeout/,
  );
});

test("failed jobs are eligible for manual batch retry, active jobs and proposals are excluded", () => {
  assert.ok(
    canRetryEnrichment({
      enrichmentJobs: [{ status: "FAILED" }],
      enrichmentProposals: [],
    }),
  );
  assert.ok(
    canRetryEnrichment({ enrichmentJobs: [], enrichmentProposals: [] }),
  );
  for (const status of ["PENDING", "RUNNING", "REVIEW"])
    assert.equal(
      canRetryEnrichment({
        enrichmentJobs: [{ status }],
        enrichmentProposals: [],
      }),
      false,
    );
  assert.equal(
    canRetryEnrichment({
      enrichmentJobs: [{ status: "FAILED" }],
      enrichmentProposals: [{}],
    }),
    false,
  );
  assert.ok(
    !enrichmentFailureMessage("openai_timeout").includes("openai_timeout"),
  );
});

test("search requests have bounded reasoning/tool calls; incomplete or ungrounded responses fail", async () => {
  const previous = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_ENRICHMENT_MODEL;
  process.env.OPENAI_API_KEY = "test-only";
  process.env.OPENAI_ENRICHMENT_MODEL = "gpt-5.6-luna";
  try {
    const input = {
      schemaName: "test",
      schema: { type: "object", properties: {}, additionalProperties: false },
      system: "test",
      user: "test",
      profile: "search" as const,
      tools: [{ type: "web_search" }],
    };
    const fake: typeof fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.store, false);
      assert.equal(body.reasoning.effort, "low");
      assert.equal(body.max_output_tokens, 3000);
      assert.equal(body.max_tool_calls, 3);
      assert.equal(body.tool_choice, "required");
      return Response.json({
        status: "completed",
        output: [{ type: "web_search_call", status: "completed" }],
        output_text: '{"ok":true}',
      });
    };
    assert.deepEqual(await requestStructured(input, fake), { ok: true });
    await assert.rejects(
      requestStructured(input, async () =>
        Response.json({ status: "incomplete", output_text: "{}" }),
      ),
      /openai_incomplete_output/,
    );
    await assert.rejects(
      requestStructured(input, async () =>
        Response.json({ status: "completed", output_text: "{}" }),
      ),
      /openai_search_not_run/,
    );
    await requestStructured(
      { ...input, profile: undefined },
      async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        assert.equal(body.max_tool_calls, undefined);
        assert.equal(body.reasoning, undefined);
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
