import Fastify from "fastify";
import { z } from "zod";
import { KaspiConnector, kaspiCapabilities } from "./connectors/kaspi.js";
import {
  buildKaspiPriceFeed,
  kaspiPriceFeedSchema,
} from "./connectors/kaspi/price-feed.js";

const app = Fastify({ logger: true });

function getKaspi() {
  const token = process.env.KASPI_API_TOKEN?.trim();
  if (!token) {
    throw new Error("KASPI_API_TOKEN is not configured");
  }

  return new KaspiConnector({
    token,
    baseUrl: process.env.KASPI_BASE_URL,
  });
}

function writesEnabled() {
  return process.env.KASPI_ALLOW_WRITES?.trim().toLowerCase() === "true";
}

app.get("/health", async () => ({
  ok: true,
  service: "marketplace-hub",
  version: "0.1.0",
}));

app.get("/v1/connectors", async () => ({
  data: [
    {
      code: "KASPI",
      enabled: Boolean(process.env.KASPI_API_TOKEN?.trim()),
      writesEnabled: writesEnabled(),
      capabilities: kaspiCapabilities,
    },
  ],
}));

app.get("/v1/kaspi/health", async (_request, reply) => {
  try {
    const result = await getKaspi().health();
    return reply.code(result.ok ? 200 : 502).send(result);
  } catch (error) {
    return reply.code(503).send({
      ok: false,
      message: error instanceof Error ? error.message : "Kaspi unavailable",
    });
  }
});

app.get("/v1/kaspi/categories", async (_request, reply) => {
  try {
    return await getKaspi().getCategories();
  } catch (error) {
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "Kaspi request failed",
    });
  }
});

app.get("/v1/kaspi/categories/:categoryCode/attributes", async (request, reply) => {
  const parsed = z
    .object({ categoryCode: z.string().trim().min(1) })
    .safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid category" });

  try {
    return await getKaspi().getAttributes(parsed.data.categoryCode);
  } catch (error) {
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "Kaspi request failed",
    });
  }
});

app.get(
  "/v1/kaspi/categories/:categoryCode/attributes/:attributeCode/values",
  async (request, reply) => {
    const parsed = z
      .object({
        categoryCode: z.string().trim().min(1),
        attributeCode: z.string().trim().min(1),
      })
      .safeParse(request.params);

    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid category or attribute" });
    }

    try {
      return await getKaspi().getAttributeValues(
        parsed.data.categoryCode,
        parsed.data.attributeCode,
      );
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Kaspi request failed",
      });
    }
  },
);

app.get("/v1/kaspi/import-schema", async (_request, reply) => {
  try {
    return await getKaspi().getImportSchema();
  } catch (error) {
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "Kaspi request failed",
    });
  }
});

app.post("/v1/kaspi/cards/import", async (request, reply) => {
  if (!writesEnabled()) {
    return reply.code(403).send({
      error: "Kaspi writes are disabled",
      hint: "Set KASPI_ALLOW_WRITES=true only after validating the target account.",
    });
  }

  if (!Array.isArray(request.body) || request.body.length === 0) {
    return reply.code(400).send({ error: "Expected a non-empty product array" });
  }

  try {
    return await getKaspi().importProducts(request.body);
  } catch (error) {
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "Kaspi import failed",
    });
  }
});

app.post("/v1/kaspi/price-feed/preview", async (request, reply) => {
  const parsed = kaspiPriceFeedSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid Kaspi price feed",
      details: parsed.error.flatten(),
    });
  }

  const xml = buildKaspiPriceFeed(parsed.data);
  return reply.type("application/xml; charset=utf-8").send(xml);
});

app.get("/v1/kaspi/orders", async (request, reply) => {
  const parsed = z
    .object({
      page: z.coerce.number().int().min(0).default(0),
      size: z.coerce.number().int().min(1).max(100).default(20),
      state: z.string().trim().optional(),
      status: z.string().trim().optional(),
    })
    .safeParse(request.query);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid query",
      details: parsed.error.flatten(),
    });
  }

  try {
    return await getKaspi().getOrders(parsed.data);
  } catch (error) {
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "Kaspi request failed",
    });
  }
});

const port = Number(process.env.PORT ?? 4100);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
