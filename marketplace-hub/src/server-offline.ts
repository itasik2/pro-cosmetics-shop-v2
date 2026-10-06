import Fastify from "fastify";
import { z } from "zod";
import { parseCsv, mapRows, mappingSchema } from "./offline/importer.js";
import { validateMasterCard } from "./offline/master-card.js";
import { parseXlsx, listWorkbookSheets } from "./offline/xlsx.js";
import { calculatePrice, pricingRuleSchema } from "./offline/pricing.js";
import {
  buildCatalogExport,
  catalogExportSchema,
} from "./offline/catalog-export.js";
import {
  buildKaspiPriceFeed,
  kaspiPriceFeedSchema,
} from "./connectors/kaspi/price-feed.js";

const app = Fastify({
  logger: true,
  bodyLimit: 20 * 1024 * 1024,
});

app.get("/health", async () => ({
  ok: true,
  service: "marketplace-hub",
  version: "0.3.0",
  mode: "offline",
}));

app.get("/v1/offline/capabilities", async () => ({
  mode: "offline",
  apiRequired: false,
  features: {
    masterCards: true,
    cardValidation: true,
    csvImport: true,
    xlsxImport: true,
    columnMapping: true,
    pricingRules: true,
    catalogExport: true,
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

app.post("/v1/offline/import/xlsx/preview", async (request, reply) => {
  const schema = z.object({
    base64: z.string().min(1),
    sheet: z.string().trim().min(1).optional(),
    mapping: mappingSchema,
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid XLSX import request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const buffer = Buffer.from(parsed.data.base64, "base64");
    const sheets = listWorkbookSheets(buffer);
    const workbook = parseXlsx(buffer, parsed.data.sheet);
    const mapped = mapRows(workbook.rows, parsed.data.mapping);

    return {
      sheets,
      selectedSheet: workbook.sheet,
      rows: mapped.length,
      validRows: mapped.filter((row) => row.valid).length,
      invalidRows: mapped.filter((row) => !row.valid).length,
      data: mapped,
    };
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "XLSX parsing failed",
    });
  }
});

app.post("/v1/offline/pricing/calculate", async (request, reply) => {
  const schema = z.object({
    purchasePrice: z.number().int().nonnegative(),
    rules: z.array(pricingRuleSchema).min(1),
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid pricing request",
      details: parsed.error.flatten(),
    });
  }

  return calculatePrice(parsed.data.purchasePrice, parsed.data.rules);
});

app.post("/v1/offline/catalog/export", async (request, reply) => {
  const parsed = catalogExportSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid catalog export",
      details: parsed.error.flatten(),
    });
  }

  return buildCatalogExport(parsed.data);
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
