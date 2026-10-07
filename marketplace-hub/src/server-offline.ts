import Fastify from "fastify";
import { z } from "zod";
import { renderAdminPage } from "./ui/admin.js";
import { parseCsv, mapRows, mappingSchema } from "./offline/importer.js";
import { validateMasterCard } from "./offline/master-card.js";
import { parseXlsx, listWorkbookSheets } from "./offline/xlsx.js";
import { calculatePrice, pricingRuleSchema } from "./offline/pricing.js";
import {
  buildCatalogExport,
  catalogExportSchema,
} from "./offline/catalog-export.js";
import {
  previewUniversalImport,
  universalImportSchema,
} from "./offline/import-engine.js";
import {
  buildKaspiPriceFeed,
  kaspiPriceFeedSchema,
} from "./connectors/kaspi/price-feed.js";
import { extractPdfCatalogRows } from "./document/pdf.js";
import {
  analyzeImage,
  MEDIA_PRESETS,
  mediaTransformSchema,
  transformImage,
} from "./media/image.js";
import {
  buildEnrichmentProposal,
  enrichmentRequestSchema,
} from "./ai/enrich.js";
import { safeFetchImage } from "./ai/network.js";
import {
  cloudinaryMediaConfigured,
  normalizeCatalogImageWithCloudinary,
} from "./media/cloudinary.js";

const app = Fastify({
  logger: true,
  bodyLimit: 25 * 1024 * 1024,
});

app.get("/", async (_request, reply) =>
  reply.type("text/html; charset=utf-8").send(renderAdminPage()),
);

app.get("/health", async () => ({
  ok: true,
  service: "marketplace-hub",
  version: "0.6.0",
  mode: "offline",
}));

app.get("/v1/offline/capabilities", async () => ({
  mode: "offline",
  apiRequired: false,
  features: {
    masterCards: true,
    cardValidation: true,
    universalImport: true,
    csvImport: true,
    xlsxImport: true,
    jsonImport: true,
    xmlImport: true,
    yamlImport: true,
    pdfImport: true,
    imageAnalysis: true,
    imageTransform: true,
    catalogAi: true,
    aiWebSearch: Boolean(process.env.OPENAI_API_KEY),
    cloudinaryBackgroundNormalization: cloudinaryMediaConfigured(),
    columnMapping: true,
    nestedFieldMapping: true,
    pricingRules: true,
    catalogExport: true,
    kaspiPriceFeedPreview: true,
    directMarketplaceSync: false,
  },
}));

app.post("/v1/offline/import/preview", async (request, reply) => {
  const parsed = universalImportSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid universal import request",
      details: parsed.error.flatten(),
    });
  }

  try {
    return previewUniversalImport(parsed.data);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "Catalog import failed",
    });
  }
});

app.post("/v1/offline/import/pdf/preview", async (request, reply) => {
  const schema = z.object({
    base64: z.string().min(1),
    mapping: mappingSchema.optional(),
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid PDF import request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const bytes = new Uint8Array(Buffer.from(parsed.data.base64, "base64"));
    const preview = await extractPdfCatalogRows(bytes);
    const mapping =
      parsed.data.mapping ??
      ({
        sku: "sku",
        title: "title",
        brand: "brand",
        barcode: "barcode",
        description: "description",
        price: "price",
        stock: "stock",
      } as const);

    const mapped = preview.rows.length ? mapRows(preview.rows, mapping) : [];

    return {
      ...preview,
      validRows: mapped.filter((row) => row.valid).length,
      invalidRows: mapped.filter((row) => !row.valid).length,
      data: mapped,
    };
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "PDF parsing failed",
    });
  }
});

app.get("/v1/offline/media/presets", async () => ({
  presets: MEDIA_PRESETS,
}));

app.post("/v1/offline/media/analyze", async (request, reply) => {
  const schema = z.object({ base64: z.string().min(1) });
  const parsed = schema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid image request",
      details: parsed.error.flatten(),
    });
  }

  try {
    return await analyzeImage(Buffer.from(parsed.data.base64, "base64"));
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "Image analysis failed",
    });
  }
});

app.post("/v1/offline/media/transform", async (request, reply) => {
  const schema = z.object({
    base64: z.string().min(1),
    preset: z
      .enum(["master", "storefront", "marketplace", "thumbnail"])
      .optional(),
    transform: z.record(z.unknown()).optional(),
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid media transform request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const transform = parsed.data.preset
      ? MEDIA_PRESETS[parsed.data.preset]
      : mediaTransformSchema.parse(parsed.data.transform ?? {});

    return await transformImage(
      Buffer.from(parsed.data.base64, "base64"),
      transform,
    );
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "Image transform failed",
    });
  }
});

app.get("/v1/offline/ai/status", async () => ({
  configured: Boolean(process.env.OPENAI_API_KEY),
  model: process.env.OPENAI_ENRICHMENT_MODEL || "gpt-6-luna",
  mode: process.env.OPENAI_API_KEY
    ? "WEB_SEARCH_AND_SOURCE_ANALYSIS"
    : "SOURCE_ANALYSIS_ONLY",
}));

app.post("/v1/offline/ai/enrich", async (request, reply) => {
  const parsed = enrichmentRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid enrichment request",
      details: parsed.error.flatten(),
    });
  }

  try {
    return await buildEnrichmentProposal(parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Product enrichment failed";
    const status =
      message === "openai_not_configured" ||
      message === "source_url_required"
        ? 503
        : 400;
    return reply.code(status).send({ error: message });
  }
});

app.post("/v1/offline/ai/image-preview", async (request, reply) => {
  const schema = z.object({
    sourceUrl: z.string().url(),
    sources: z.array(
      z.object({
        domain: z.string().trim().min(1),
        allowSubdomains: z.boolean().default(true),
        sourceType: z
          .enum(["OFFICIAL_SITE", "DISTRIBUTOR", "DISCOVERED_WEB"])
          .optional(),
      }),
    ).min(1),
    preset: z
      .enum(["master", "storefront", "marketplace", "thumbnail"])
      .default("storefront"),
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid enrichment image request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const fetched = await safeFetchImage(
      parsed.data.sourceUrl,
      parsed.data.sources,
    );
    const result = await transformImage(
      fetched.buffer,
      MEDIA_PRESETS[parsed.data.preset],
    );

    return {
      sourceUrl: fetched.finalUrl,
      contentType: fetched.contentType,
      preset: parsed.data.preset,
      ...result,
    };
  } catch (error) {
    return reply.code(400).send({
      error:
        error instanceof Error ? error.message : "Enrichment image failed",
    });
  }
});

app.get("/v1/offline/media/cloud-status", async () => ({
  configured: cloudinaryMediaConfigured(),
}));

app.post("/v1/offline/media/background-normalize", async (request, reply) => {
  const schema = z.object({
    base64: z.string().min(1),
    canvas: z.number().int().min(600).max(2400).optional(),
    content: z.number().int().min(400).max(2400).optional(),
    background: z.string().trim().min(1).max(32).optional(),
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid background normalization request",
      details: parsed.error.flatten(),
    });
  }

  if (!cloudinaryMediaConfigured()) {
    return reply.code(503).send({ error: "cloudinary_not_configured" });
  }

  try {
    return await normalizeCatalogImageWithCloudinary(
      Buffer.from(parsed.data.base64, "base64"),
      {
        canvas: parsed.data.canvas,
        content: parsed.data.content,
        background: parsed.data.background,
      },
    );
  } catch (error) {
    return reply.code(400).send({
      error:
        error instanceof Error
          ? error.message
          : "Background normalization failed",
    });
  }
});

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
