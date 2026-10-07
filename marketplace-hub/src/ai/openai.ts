import { isIP } from "node:net";
import { z } from "zod";
import type {
  CatalogProductInput,
  ExtractedProductData,
  GeneratedProductCopy,
} from "./types.js";

const SearchResultSchema = z.object({
  found: z.boolean(),
  url: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  reason: z.string(),
});

const CopySchema = z.object({
  shortDescription: z.string(),
  description: z.string(),
  application: z.string(),
  ingredients: z.string(),
  warnings: z.array(z.string()),
});

function getOutputText(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const root = data as Record<string, unknown>;
  if (typeof root.output_text === "string") return root.output_text;

  if (!Array.isArray(root.output)) return "";
  for (const item of root.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const object = part as Record<string, unknown>;
      if (
        (object.type === "output_text" || object.type === "text") &&
        typeof object.text === "string"
      ) {
        return object.text;
      }
    }
  }

  return "";
}

async function requestStructured(input: {
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  tools?: Record<string, unknown>[];
  timeoutMs?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai_not_configured");

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1_000, input.timeoutMs ?? 30_000),
  );

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_ENRICHMENT_MODEL || "gpt-6-luna",
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: input.system }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: input.user }],
          },
        ],
        tools: input.tools || [],
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        data && typeof data === "object"
          ? JSON.stringify(data).slice(0, 800)
          : String(data);
      throw new Error(`openai_http_${response.status}:${message}`);
    }

    const text = getOutputText(data);
    if (!text) throw new Error("openai_empty_output");

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("openai_invalid_json");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("openai_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function productLabel(product: CatalogProductInput) {
  return [
    `Бренд: ${product.brand || "не указан"}`,
    `Название: ${product.title}`,
    `SKU: ${product.sku || "не указан"}`,
    `Штрихкод: ${product.barcode || "не указан"}`,
    `Категория: ${product.categoryKey || "не указана"}`,
    `Объём: ${product.volumeValue && product.volumeUnit ? `${product.volumeValue} ${product.volumeUnit}` : "не указан"}`,
  ].join("\n");
}

function validatedAllowedUrl(rawUrl: string, allowedDomains: string[]) {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.port) return null;
    const hostname = normalizeDomain(url.hostname);
    if (isIP(hostname)) return null;

    const allowed = allowedDomains.some((value) => {
      const domain = normalizeDomain(value);
      return Boolean(
        domain && (hostname === domain || hostname.endsWith(`.${domain}`)),
      );
    });

    if (!allowed) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

const EXTERNAL_BLOCKED_HOSTS = [
  "kaspi.kz",
  "wildberries.ru",
  "wildberries.kz",
  "ozon.ru",
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "youtube.com",
  "telegram.org",
  "t.me",
  "pinterest.com",
];

function validatedExternalUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.port) return null;
    const hostname = normalizeDomain(url.hostname);
    if (!hostname || isIP(hostname)) return null;
    if (
      EXTERNAL_BLOCKED_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`),
      )
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function findOfficialProductUrl(input: {
  product: CatalogProductInput;
  allowedDomains: string[];
}) {
  const domains = [...new Set(input.allowedDomains.map(normalizeDomain))].filter(Boolean);
  if (!domains.length) throw new Error("allowed_domains_required");

  const raw = await requestStructured({
    schemaName: "catalog_hub_official_product_page",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["found", "url", "confidence", "reason"],
      properties: {
        found: { type: "boolean" },
        url: { type: ["string", "null"] },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        reason: { type: "string" },
      },
    },
    system:
      "Найди прямую страницу конкретного товара только на разрешённых официальных доменах. Проверяй бренд, SKU, штрихкод, название и объём. Не возвращай категории, поиск, корзину или другой товар. Если точного совпадения нет, found=false.",
    user: `${productLabel(input.product)}\n\nРазрешённые домены: ${domains.join(", ")}`,
    tools: [{ type: "web_search", search_context_size: "low" }],
    timeoutMs: 15_000,
  });

  const result = SearchResultSchema.parse(raw);
  if (!result.found || !result.url) return { ...result, found: false, url: null };

  const url = validatedAllowedUrl(result.url, domains);
  if (!url) {
    return {
      found: false,
      url: null,
      confidence: 0,
      reason: "Найденный URL не относится к разрешённым доменам.",
    };
  }

  return { ...result, url };
}

export async function findExternalProductUrl(input: {
  product: CatalogProductInput;
  officialDomainsTried?: string[];
}) {
  const raw = await requestStructured({
    schemaName: "catalog_hub_external_product_page",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["found", "url", "confidence", "reason"],
      properties: {
        found: { type: "boolean" },
        url: { type: ["string", "null"] },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        reason: { type: "string" },
      },
    },
    system:
      "Официальная страница не найдена. Найди прямую страницу точно этого товара у надёжного дистрибьютора или профессионального магазина. Не используй маркетплейсы, соцсети, блоги, отзывы, агрегаторы и страницы поиска. SKU/штрихкод — сильнейшее подтверждение. Если точного совпадения нет, found=false.",
    user: `${productLabel(input.product)}\n\nОфициальные домены уже проверены: ${(input.officialDomainsTried || []).join(", ") || "нет"}`,
    tools: [{ type: "web_search", search_context_size: "medium" }],
    timeoutMs: 20_000,
  });

  const result = SearchResultSchema.parse(raw);
  if (!result.found || !result.url) return { ...result, found: false, url: null };

  const url = validatedExternalUrl(result.url);
  if (!url) {
    return {
      found: false,
      url: null,
      confidence: 0,
      reason: "Найденный URL не подходит для проверяемого внешнего источника.",
    };
  }

  return { ...result, url };
}

function removePromotionalText(value: string) {
  return value
    .split(/(?<=[.!?])\s+/u)
    .filter(
      (sentence) =>
        !/\b(?:купить|заказать|скидк|доставк|цена|в наличии|магазин)\b/iu.test(
          sentence,
        ),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortCopy(value: string) {
  const cleaned = removePromotionalText(value);
  if (cleaned.length <= 280) return cleaned;
  return `${cleaned.slice(0, 277).replace(/[\s,;:-]+$/u, "")}…`;
}

export async function generateProductCopy(input: {
  product: CatalogProductInput;
  extracted: ExtractedProductData;
  sourceUrl: string;
}): Promise<GeneratedProductCopy> {
  const raw = await requestStructured({
    schemaName: "catalog_hub_product_copy",
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "shortDescription",
        "description",
        "application",
        "ingredients",
        "warnings",
      ],
      properties: {
        shortDescription: { type: "string" },
        description: { type: "string" },
        application: { type: "string" },
        ingredients: { type: "string" },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    system: [
      "Подготовь черновик карточки профессиональной косметики только из переданных подтверждённых фактов.",
      "Не придумывай медицинские свойства, состав, сертификаты, тип кожи, объём, способ применения или результат.",
      "Не добавляй цену, наличие, доставку, города, магазин и призывы купить.",
      "Краткое описание — до 280 символов. Полное описание — структурированное, информативное, без рекламного шума.",
      "Если данных для application или ingredients нет, верни пустую строку и добавь warning.",
    ].join("\n"),
    user: JSON.stringify({
      product: input.product,
      sourceUrl: input.sourceUrl,
      extracted: input.extracted,
    }),
    timeoutMs: 20_000,
  });

  const result = CopySchema.parse(raw);
  return {
    ...result,
    shortDescription: shortCopy(result.shortDescription),
    description: removePromotionalText(result.description),
  };
}

export function fallbackProductCopy(
  extracted: ExtractedProductData,
): GeneratedProductCopy {
  const description = removePromotionalText(extracted.description || "");
  return {
    shortDescription: shortCopy(description),
    description,
    application: extracted.application || "",
    ingredients: extracted.ingredients || "",
    warnings: [
      "openai_not_configured",
      ...(!description ? ["description_missing"] : []),
      ...(!extracted.application ? ["application_missing"] : []),
      ...(!extracted.ingredients ? ["ingredients_missing"] : []),
    ],
  };
}
