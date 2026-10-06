import Fastify from "fastify";
import { z } from "zod";
import { KaspiConnector, kaspiCapabilities } from "./connectors/kaspi.js";

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

app.get("/v1/kaspi/import-schema", async (_request, reply) => {
  try {
    return await getKaspi().getImportSchema();
  } catch (error) {
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "Kaspi request failed",
    });
  }
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
