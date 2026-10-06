import Fastify from "fastify";
import { z } from "zod";
import { parseCsv, mapRows, mappingSchema } from "./offline/importer.js";
import { validateMasterCard } from "./offline/master-card.js";
import {
  buildKaspiPriceFeed,
  kaspiPriceFeedSchema,
} from "./connectors/kaspi/price-feed.js";

const app = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024,
});

app.get("/health", async () => ({
  ok: true,
  service: "marketplace-hub",
  version: "0.2.0",
  mode: "offline",
}));

app.get("/v1/offline/capabilities", async () => ({
  mode: "offline",
  apiRequired: false,
  features: {
    masterCards: true,
    cardValidation: true,
    csvImport: true,
    columnMapping: true,
    kaspiPriceFeedPreview: true,
    kaspiCardDrafts: true,
    directMarketplaceSync: false,
  },
}));

app.post("/v1/offline/cards/validate", async (request, reply) => {
  const result = validateMasterCard(request.body);
  return reply.code(result.valid ? 200 : 400).send(result);
});

app.post("/v1/offline/import/csv", async (request, reply) => {
  const schema = z.object({
    text: z.string().min(1),
    delimiter: z.string().length(1).default(";"),
    mapping: mappingSchema,
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid CSV import request",
      details: parsed.error.flatten(),
    });
  }

  const rows = parseCsv(parsed.data.text, parsed.data.delimiter);
  const mapped = mapRows(rows, parsed.data.mapping);

  return {
    rows: mapped.length,
    validRows: mapped.filter((row) => row.valid).length,
    invalidRows: mapped.filter((row) => !row.valid).length,
    data: mapped,
  };
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

const port = Number(process.env.PORT ?? 4100);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
