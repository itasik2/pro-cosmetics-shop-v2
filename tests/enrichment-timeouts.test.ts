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
import {
  resolveProductSource,
  sourceUrlKey,
  type SourceSearchResult,
} from "../lib/enrichment/resolveProductSource";
import { extractProductFromHtml } from "../lib/enrichment/extractProduct";
import { scoreProductMatch } from "../lib/enrichment/matchProduct";

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

const candidate = (url: string): SourceSearchResult => ({
  found: true,
  url,
  confidence: 100,
  reason: "SKU match",
});
const sourceOptions = () => ({
  discover: true,
  excludedUrls: [] as string[],
  deadlineAt: Date.now() + 150_000,
});

test("RG06 discovery fetches and validates pages before choosing an official or external result", async () => {
  const saved = "https://angiopharm.kz/old-RG06";
  const catalog = "https://angiopharm.com/catalog-RG06";
  const official =
    "https://angiopharm.kz/index.php?product_id=471&route=product%2Fproduct";
  const external = "https://seller.example/regenerating-gel-mask";
  const requests: string[] = [];
  const rejected: string[] = [];
  const page = `<html><head><script type="application/ld+json">${JSON.stringify(
    {
      "@type": "Product",
      name: "Регенерирующая гель-маска, 75 мл",
      sku: "RG06",
      brand: { name: "Angiopharm" },
      description: "Увлажняющая гель-маска для ухода за кожей.",
      image: "https://seller.example/RG06.jpg",
    },
  )}</script></head><body><h1>Регенерирующая гель-маска, 75 мл</h1></body></html>`;
  const product = {
    name: "Регенерирующая гель-маска",
    supplierSku: "RG06",
    barcode: null,
    volumeValue: 75,
    volumeUnit: "ml",
    brand: { name: "Angiopharm" },
    supplier: null,
  };
  const result = await resolveProductSource({
    ...sourceOptions(),
    initialUrl: saved,
    stages: [
      {
        stage: "catalog",
        find: async (excluded) => {
          assert.ok(excluded.includes(saved));
          return candidate(catalog);
        },
      },
      {
        stage: "official",
        find: async (excluded) => {
          assert.ok(excluded.includes(catalog));
          return candidate(official);
        },
      },
      {
        stage: "external",
        find: async (excluded) => {
          assert.ok(excluded.includes(official));
          return candidate(external);
        },
      },
    ],
    inspect: async (url) => {
      const fetched = await safeFetchExternal(
        url,
        {
          policies: ["angiopharm.kz", "angiopharm.com", "seller.example"].map(
            (domain) => ({ domain, allowSubdomains: false }),
          ),
          maxBytes: 10000,
          acceptedContentTypes: ["text/html"],
          timeoutMs: 1000,
        },
        {
          resolveHostname: async () => [{ address: "8.8.8.8", family: 4 }],
          fetcher: async (target) => {
            requests.push(String(target));
            return new Response(
              String(target) === external ? page : "Not found",
              {
                status: String(target) === external ? 200 : 404,
                headers: { "content-type": "text/html" },
              },
            );
          },
        },
      );
      const extracted = extractProductFromHtml({
        buffer: fetched.buffer,
        finalUrl: fetched.finalUrl,
        expectedSku: product.supplierSku,
      });
      const match = scoreProductMatch(product, extracted);
      if (match.confidence === 0)
        throw new Error("product_match_zero_confidence");
      return { fetched, extracted };
    },
    onRejected: async ({ url }) => {
      rejected.push(url);
    },
  });
  assert.equal(result.searchResult.searchStage, "external");
  assert.equal(result.value.fetched.finalUrl, external);
  assert.equal(result.value.extracted.sku, "RG06");
  assert.deepEqual(result.value.extracted.images, [
    "https://seller.example/RG06.jpg",
  ]);
  assert.deepEqual(requests, [saved, catalog, official, external]);
  assert.deepEqual(rejected, [saved, catalog, official]);
});

test("an inaccessible newly discovered official URL falls through even without a saved source", async () => {
  const result = await resolveProductSource({
    ...sourceOptions(),
    stages: [
      {
        stage: "official",
        find: async () => candidate("https://brand.example/removed"),
      },
      {
        stage: "external",
        find: async () => candidate("https://seller.example/valid"),
      },
    ],
    inspect: async (url) => {
      if (url.includes("brand.example")) throw new Error("source_http_404");
      return url;
    },
  });
  assert.equal(result.value, "https://seller.example/valid");
});

test("equivalent excluded URLs and a repeated dead result are never fetched again", async () => {
  const url =
    "https://brand.example/index.php?route=product/product&product_id=471";
  const equivalent =
    "https://brand.example/index.php?product_id=471&route=product%2Fproduct#photo";
  assert.equal(sourceUrlKey(url), sourceUrlKey(equivalent));
  const inspected: string[] = [];
  const result = await resolveProductSource({
    ...sourceOptions(),
    initialUrl: url,
    stages: [
      { stage: "official", find: async () => candidate(equivalent) },
      {
        stage: "external",
        find: async () => candidate("https://seller.example/valid"),
      },
    ],
    inspect: async (target) => {
      inspected.push(target);
      if (target === url) throw new Error("source_http_410");
      return target;
    },
  });
  assert.equal(result.searchResult.searchStage, "external");
  assert.deepEqual(inspected, [url, "https://seller.example/valid"]);
});

test("an unrelated official page is rejected before the matching external page is accepted", async () => {
  const result = await resolveProductSource({
    ...sourceOptions(),
    stages: [
      {
        stage: "official",
        find: async () => candidate("https://brand.example/wrong-sku"),
      },
      {
        stage: "external",
        find: async () => candidate("https://seller.example/RG06"),
      },
    ],
    inspect: async (url) => {
      if (url.includes("wrong-sku"))
        throw new Error("product_match_zero_confidence");
      return url;
    },
  });
  assert.equal(result.value, "https://seller.example/RG06");
  assert.equal(
    result.searchResult.rejectedSources[0].reason,
    "product_match_zero_confidence",
  );
});

test("dead pages and unfinished searches are not reported as confirmed product absence", async () => {
  await assert.rejects(
    resolveProductSource({
      ...sourceOptions(),
      stages: [
        {
          stage: "official",
          find: async () => candidate("https://brand.example/dead"),
        },
        { stage: "external", find: async () => notFound },
      ],
      inspect: async () => {
        throw new Error("source_http_404");
      },
    }),
    /product_sources_unavailable/,
  );
  await assert.rejects(
    resolveProductSource({
      ...sourceOptions(),
      stages: [
        {
          stage: "official",
          find: async () => {
            throw new Error("openai_timeout");
          },
        },
        { stage: "external", find: async () => notFound },
      ],
      inspect: async () => assert.fail("no candidate to fetch"),
    }),
    /openai_search_incomplete/,
  );
});

test("source discovery retains the deadline and stops on security or credential errors", async () => {
  for (const failure of [
    "source_domain_not_allowed",
    "source_ip_blocked",
    "source_dns_blocked",
    "openai_http_403:forbidden",
    "openai_http_429:quota",
  ]) {
    await assert.rejects(
      resolveProductSource({
        ...sourceOptions(),
        stages: [
          {
            stage: "official",
            find: async () => {
              if (failure.startsWith("openai_")) throw new Error(failure);
              return candidate("https://brand.example/product");
            },
          },
          {
            stage: "external",
            find: async () => assert.fail("must not work around this error"),
          },
        ],
        inspect: async () => {
          throw new Error(failure);
        },
      }),
      new RegExp(failure),
    );
  }
  await assert.rejects(
    resolveProductSource({
      ...sourceOptions(),
      deadlineAt: Date.now(),
      stages: [
        {
          stage: "official",
          find: async () => assert.fail("deadline already expired"),
        },
      ],
      inspect: async () => assert.fail("deadline already expired"),
    }),
    /enrichment_timeout/,
  );
});

test("an explicitly supplied broken link fails clearly without switching to another source", async () => {
  for (const flags of [
    { explicit: true, discover: true },
    { explicit: false, discover: false },
  ]) {
    await assert.rejects(
      resolveProductSource({
        ...sourceOptions(),
        ...flags,
        initialUrl: "https://brand.example/removed",
        stages: [
          {
            stage: "external",
            find: async () => assert.fail("manual source must not switch"),
          },
        ],
        inspect: async () => {
          throw new Error("source_http_404");
        },
        onRejected: async () =>
          assert.fail("explicit source is not an automatic cache cleanup"),
      }),
      /source_http_404/,
    );
  }
  assert.ok(
    !enrichmentFailureMessage("source_http_404").includes("source_http_404"),
  );
  assert.match(
    enrichmentFailureMessage("product_sources_unavailable"),
    /устарели|недоступны/,
  );
});

test("a valid saved source is reused without a discovery call or a second page fetch", async () => {
  let reads = 0;
  const result = await resolveProductSource({
    ...sourceOptions(),
    initialUrl: "https://brand.example/product",
    stages: [
      {
        stage: "official",
        find: async () => assert.fail("saved page already matches"),
      },
    ],
    inspect: async () => {
      reads++;
      return { html: "valid" };
    },
  });
  assert.equal(reads, 1);
  assert.equal(result.searchResult.searchStage, "saved");
});

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
