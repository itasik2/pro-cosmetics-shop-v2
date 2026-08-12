import { isIP } from "node:net";
import { z } from "zod";
import type { ExtractedProductData } from "./extractProduct";
import type { MatchableProduct } from "./matchProduct";

const SearchResultSchema = z.object({
  found: z.boolean(),
  url: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  reason: z.string(),
});

const DescriptionResultSchema = z.object({
  shortDescription: z.string(),
  description: z.string(),
  application: z.string(),
  ingredients: z.string(),
  warnings: z.array(z.string()),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;
export type GeneratedDescription = z.infer<typeof DescriptionResultSchema>;

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
  const timeout = setTimeout(
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
        model: process.env.OPENAI_ENRICHMENT_MODEL || "gpt-4.1-mini",
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
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("openai_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function productLabel(product: MatchableProduct) {
  const volume =
    product.volumeValue && product.volumeUnit
      ? `${product.volumeValue} ${product.volumeUnit}`
      : "объём не указан";
  const brand = product.brand?.name || product.supplier?.name || "бренд не указан";

  return [
    `Бренд: ${brand}`,
    `Название: ${product.name}`,
    `SKU: ${product.supplierSku || "не указан"}`,
    `Штрихкод: ${product.barcode || "не указан"}`,
    `Объём: ${volume}`,
  ].join("\n");
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function validatedAllowedUrl(rawUrl: string, allowedDomains: string[]) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;

    const hostname = normalizeDomain(url.hostname);
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

const BLOCKED_EXTERNAL_DOMAINS = [
  "google.com",
  "yandex.ru",
  "bing.com",
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "youtube.com",
  "vk.com",
  "ozon.ru",
  "wildberries.ru",
  "wildberries.kz",
  "kaspi.kz",
  "market.yandex.ru",
  "irecommend.ru",
  "otzovik.com",
];

function blockedExternalDomain(hostname: string) {
  return (
    BLOCKED_EXTERNAL_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    ) ||
    /(^|\.)wildberries\.[a-z.]+$/i.test(hostname) ||
    /(^|\.)ozon\.[a-z.]+$/i.test(hostname)
  );
}

export function validatedExternalProductUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.port) return null;

    const hostname = normalizeDomain(url.hostname).replace(/^www\./, "");
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      isIP(hostname) ||
      blockedExternalDomain(hostname)
    ) {
      return null;
    }

    if (!url.pathname || url.pathname === "/") return null;

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function findOfficialProductUrl(input: {
  product: MatchableProduct;
  allowedDomains: string[];
  excludedUrls?: string[];
}): Promise<SearchResult> {
  const allowedDomains = [...new Set(input.allowedDomains.map(normalizeDomain))].filter(
    Boolean,
  );
  if (!allowedDomains.length) throw new Error("allowed_domains_required");

  const excludedUrls = [...new Set((input.excludedUrls || []).map((value) => value.trim()))]
    .filter(Boolean)
    .slice(0, 10);

  const raw = await requestStructured({
    schemaName: "official_product_page",
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
      "Найди страницу конкретного товара только на разрешённых официальных доменах. Используй поисковые запросы с ограничением site:домен. Не подставляй страницу категории, поиска, корзины или другого объёма. Не возвращай URL из списка исключений. Если точного совпадения нет, верни found=false. URL должен быть прямой страницей товара.",
    user: `${productLabel(input.product)}\n\nРазрешённые домены: ${allowedDomains.join(", ")}\nИсключённые URL: ${excludedUrls.join(", ") || "нет"}`,
    tools: [
      {
        type: "web_search",
        search_context_size: "low",
      },
    ],
    timeoutMs: 14_000,
  });

  const result = SearchResultSchema.parse(raw);
  if (!result.found || !result.url) {
    return { ...result, found: false, url: null };
  }

  const url = validatedAllowedUrl(result.url, allowedDomains);
  if (!url) {
    return {
      found: false,
      url: null,
      confidence: 0,
      reason: "Найденный адрес не относится к разрешённым официальным доменам.",
    };
  }

  if (excludedUrls.includes(url)) {
    return {
      found: false,
      url: null,
      confidence: 0,
      reason: "Поиск повторно вернул уже исключённый нерабочий адрес.",
    };
  }

  return { ...result, url };
}

export async function findExternalProductUrl(input: {
  product: MatchableProduct;
  officialDomainsTried?: string[];
  excludedUrls?: string[];
}): Promise<SearchResult> {
  const officialDomainsTried = [
    ...new Set((input.officialDomainsTried || []).map(normalizeDomain)),
  ].filter(Boolean);
  const excludedUrls = [
    ...new Set((input.excludedUrls || []).map((value) => value.trim())),
  ]
    .filter(Boolean)
    .slice(0, 10);

  const raw = await requestStructured({
    schemaName: "trusted_product_page",
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
      "Официальный поиск уже не нашёл точную карточку. Найди прямую страницу этого товара у надёжного дистрибьютора, профессионального магазина косметики или профильной клиники. Сначала предпочитай источники Казахстана, затем другие страны. Проверяй бренд и название; SKU или штрихкод считай сильнейшим подтверждением. Разрешено использовать страницу другой фасовки только если базовый товар и его назначение полностью совпадают: объём будет отдельным вариантом и всё равно пройдёт ручную проверку. Не используй маркетплейсы, социальные сети, отзывы, блоги, агрегаторы, страницы поиска, категории, корзину и скопированные объявления. Не возвращай официальный домен, который уже проверялся, или URL из списка исключений. Если надёжного точного совпадения нет, верни found=false. Возвращай только прямую страницу товара.",
    user: `${productLabel(input.product)}\n\nУже проверенные официальные домены: ${officialDomainsTried.join(", ") || "нет"}\nИсключённые URL: ${excludedUrls.join(", ") || "нет"}`,
    tools: [
      {
        type: "web_search",
        search_context_size: "medium",
      },
    ],
    timeoutMs: 20_000,
  });

  const result = SearchResultSchema.parse(raw);
  if (!result.found || !result.url) {
    return { ...result, found: false, url: null };
  }

  const url = validatedExternalProductUrl(result.url);
  if (!url) {
    return {
      found: false,
      url: null,
      confidence: 0,
      reason: "Найденный адрес не является разрешённой прямой страницей проверяемого продавца.",
    };
  }

  const hostname = normalizeDomain(new URL(url).hostname);
  const repeatsOfficialDomain = officialDomainsTried.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  if (repeatsOfficialDomain || excludedUrls.includes(url)) {
    return {
      found: false,
      url: null,
      confidence: 0,
      reason: "Поиск повторно вернул уже проверенный или исключённый адрес.",
    };
  }

  return { ...result, url };
}

export async function generateProductDescription(input: {
  product: MatchableProduct;
  extracted: ExtractedProductData;
  sourceUrl: string;
}): Promise<GeneratedDescription> {
  const facts = {
    product: productLabel(input.product),
    sourceUrl: input.sourceUrl,
    sourceTitle: input.extracted.title,
    sourceDescription: input.extracted.description,
    ingredients: input.extracted.ingredients,
    application: input.extracted.application,
    sourceSku: input.extracted.sku,
    sourceBrand: input.extracted.brand,
  };

  const raw = await requestStructured({
    schemaName: "product_description_draft",
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
    system:
      "Создай черновик карточки профессиональной косметики только из переданных фактов. Не придумывай состав, сертификаты, медицинские свойства, объём, способ применения или обещания результата. Не копируй исходный текст дословно большими фрагментами. Пиши по-русски, нейтрально и понятно. Если данных для поля нет, верни пустую строку и добавь предупреждение.",
    user: JSON.stringify(facts),
    timeoutMs: 10_000,
  });

  return DescriptionResultSchema.parse(raw);
}

export function fallbackDescription(
  extracted: ExtractedProductData,
): GeneratedDescription {
  const description = extracted.description || "";
  return {
    shortDescription: description.slice(0, 280),
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
