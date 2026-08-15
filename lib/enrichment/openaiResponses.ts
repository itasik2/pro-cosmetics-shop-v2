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

const CatalogPopularityResponseSchema = z.object({
  results: z.array(
    z.object({
      productId: z.string(),
      score: z.number().int().min(0).max(100),
      confidence: z.number().int().min(0).max(100),
      reason: z.string(),
      evidenceUrls: z.array(z.string()).max(5),
    }),
  ),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;
export type GeneratedDescription = z.infer<typeof DescriptionResultSchema>;
export type CatalogPopularityCandidate = {
  id: string;
  name: string;
  brandName?: string | null;
  category?: string | null;
  shortDescription?: string | null;
};
export type CatalogPopularityAssessment = {
  productId: string;
  score: number;
  confidence: number;
  reason: string;
  evidenceUrls: string[];
};

const PROMOTIONAL_DESCRIPTION_PATTERN =
  /(?:^|[^\p{L}\p{N}])(?:купить|покупайте|заказ(?:ать|ы|ом|а|у|е|ывайте)?|цен(?:а|ы|е|у|ой|ам|ами)?|доставк[а-я]*|интернет[-\s]?магазин[а-я]*|магазин[а-я]*|продаж[а-я]*|скидк[а-я]*|оптом|розниц[а-я]*|в\s+наличии|казахстан(?:е|а|у)?|алмат(?:ы|е|а|у)?|астан(?:а|е|ы|у)?|нур[-\s]?султан(?:е|а|у)?)(?=$|[^\p{L}\p{N}])|от\s+производителя/iu;

function normalizeDescriptionText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function removeInternalDescriptionMarkers(value: unknown) {
  return String(value || "")
    .replace(
      /(?:предупреждение:\s*)?skin_type_not_confirmed[.!]?/giu,
      "",
    )
    .replace(/[ \t]+([,.;:!?])/gu, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removePromotionalDescriptionSentences(value: unknown) {
  const source = removeInternalDescriptionMarkers(value);
  if (!source) return "";

  return source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/u)
        .map(normalizeDescriptionText)
        .filter(
          (sentence) =>
            sentence.length > 0 &&
            !PROMOTIONAL_DESCRIPTION_PATTERN.test(sentence),
        )
        .join(" "),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateAtWord(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;

  const contentLimit = Math.max(1, maxLength - 1);
  const shortened = value.slice(0, contentLimit + 1);
  const wordBoundary = shortened.lastIndexOf(" ");
  const result = (wordBoundary > contentLimit * 0.6
    ? shortened.slice(0, wordBoundary)
    : shortened.slice(0, contentLimit)
  )
    .replace(/[,:;\s-]+$/u, "")
    .trim();

  return result ? `${result}…` : "";
}

export function sanitizeShortDescription(value: unknown) {
  return truncateAtWord(
    normalizeDescriptionText(removePromotionalDescriptionSentences(value)),
    280,
  );
}

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
    `Категория каталога: ${product.category || "не указана"}`,
    `Линия: ${product.productLineName || "не указана"}`,
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

function validatedPopularityEvidenceUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function assessCatalogPopularity(input: {
  candidates: CatalogPopularityCandidate[];
  market?: string;
}): Promise<CatalogPopularityAssessment[]> {
  const candidates = input.candidates.slice(0, 20);
  if (!candidates.length) return [];

  const raw = await requestStructured({
    schemaName: "catalog_product_popularity",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "productId",
              "score",
              "confidence",
              "reason",
              "evidenceUrls",
            ],
            properties: {
              productId: { type: "string" },
              score: { type: "integer", minimum: 0, maximum: 100 },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
              reason: { type: "string" },
              evidenceUrls: {
                type: "array",
                maxItems: 5,
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
    system: [
      "Оцени текущий публичный интерес в интернете только к переданным товарам профессиональной косметики.",
      "Для каждого кандидата используй web search и проверяй точное совпадение бренда и названия. В первую очередь учитывай рынок Казахстана, затем устойчивый международный интерес, если локальных данных мало.",
      "Сигналами могут быть повторяющиеся упоминания на независимых профильных ресурсах, у нескольких профессиональных продавцов, в редакционных подборках и обсуждениях ухода. Одна карточка продавца, официальный листинг или переданное описание сами по себе не доказывают популярность.",
      "Шкала должна быть абсолютной и сопоставимой между разными запусками: 0–39 — заметного независимого сигнала нет; 40–64 — отдельные или слабые сигналы; 65–79 — устойчивый интерес в нескольких источниках; 80–100 — сильный и широко подтверждённый актуальный интерес.",
      "Confidence показывает уверенность, что найденные материалы относятся именно к этому товару. При неоднозначном названии, смешении с другим объёмом или отсутствии дат снижай confidence.",
      "Верни только productId из входного списка. Не предлагай новые товары. Для каждого подтверждения верни прямой URL; не выдумывай ссылки. Причину сформулируй кратко на русском языке.",
    ].join("\n"),
    user: JSON.stringify({
      market: input.market || "Казахстан",
      candidates: candidates.map((candidate) => ({
        productId: candidate.id,
        brand: candidate.brandName || "не указан",
        name: candidate.name,
        category: candidate.category || "не указана",
        context: candidate.shortDescription || "",
      })),
    }),
    tools: [
      {
        type: "web_search",
        search_context_size: "medium",
      },
    ],
    timeoutMs: 45_000,
  });

  const parsed = CatalogPopularityResponseSchema.parse(raw);
  const allowedIds = new Set(candidates.map((candidate) => candidate.id));
  const seenIds = new Set<string>();

  return parsed.results.flatMap((result) => {
    if (!allowedIds.has(result.productId) || seenIds.has(result.productId)) {
      return [];
    }
    seenIds.add(result.productId);

    const evidenceUrls = [...new Set(result.evidenceUrls)]
      .map(validatedPopularityEvidenceUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 5);

    return [
      {
        productId: result.productId,
        score: result.score,
        confidence: result.confidence,
        reason: result.reason.replace(/\s+/g, " ").trim().slice(0, 600),
        evidenceUrls,
      },
    ];
  });
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
    skinTypeOrCondition: input.extracted.skinType,
    confirmedBenefits: input.extracted.benefits,
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
    system: [
      "Ты редактор карточек профессиональной косметики. Создай информативный и убедительный текст только из переданных фактов.",
      "Не придумывай состав, сертификаты, медицинские свойства, тип кожи, объём, способ применения или гарантированный результат. Не копируй исходный текст дословно большими фрагментами.",
      "Краткое описание: 1–2 живых предложения до 280 символов. Сразу объясни, что это за средство, кому или для каких задач оно подходит и назови 2–3 главных подтверждённых преимущества. Это не SEO-заголовок.",
      "Полное описание: ориентир 600–1200 символов, если фактов достаточно. Сделай 3–5 коротких абзацев с пустой строкой между ними.",
      "Первый абзац должен ясно назвать формат средства и его основное назначение. Далее раскрой подтверждённые потребности кожи, ожидаемый уходовый эффект, ключевые преимущества и место средства в уходе.",
      "Если источник прямо указывает тип или состояние кожи, добавь отдельный абзац с заголовком «Для какой кожи» и перечисли их. Если тип кожи не подтверждён, не пиши «для всех типов»: опиши только подтверждённые задачи кожи в абзаце «Для каких задач», а код skin_type_not_confirmed добавь только в массив warnings. Никогда не включай служебные коды в краткое или полное описание.",
      "Если подтверждены преимущества, можно использовать заголовок «Преимущества» и 3–5 коротких строк с маркером •. Активные компоненты упоминай только вместе с подтверждённой ролью; полный состав не дублируй.",
      "Заверши естественной фразой о том, кому средство будет особенно полезно или почему его удобно включить в уход, но только на основе фактов.",
      "Тон — профессиональный, понятный, тёплый и продающий через пользу продукта. Не используй пустые эпитеты, давление, срочность, превосходную степень и неподтверждённые обещания.",
      "В содержимом не должно быть рекламных SEO-фраз: не призывай купить или заказать, не упоминай цену, наличие, доставку, страны, города, магазин или фразу «от производителя».",
      "Поля application и ingredients заполняй отдельно по источнику. Если подтверждённых данных для поля нет, верни пустую строку и добавь понятное предупреждение.",
    ].join("\n"),
    user: JSON.stringify(facts),
    timeoutMs: 18_000,
  });

  const generated = DescriptionResultSchema.parse(raw);
  const shortDescription = sanitizeShortDescription(
    generated.shortDescription,
  );
  const description = removePromotionalDescriptionSentences(
    generated.description,
  );
  const filtered =
    normalizeDescriptionText(shortDescription) !==
      normalizeDescriptionText(generated.shortDescription) ||
    normalizeDescriptionText(description) !==
      normalizeDescriptionText(generated.description);

  return {
    ...generated,
    shortDescription,
    description,
    warnings: [
      ...generated.warnings,
      ...(filtered ? ["promotional_description_removed"] : []),
    ],
  };
}

export function fallbackDescription(
  extracted: ExtractedProductData,
): GeneratedDescription {
  const sourceDescription = normalizeDescriptionText(extracted.description);
  const description = removePromotionalDescriptionSentences(sourceDescription);
  const shortDescription = sanitizeShortDescription(description);
  return {
    shortDescription,
    description,
    application: extracted.application || "",
    ingredients: extracted.ingredients || "",
    warnings: [
      "openai_not_configured",
      ...(!description ? ["description_missing"] : []),
      ...(sourceDescription && sourceDescription !== description
        ? ["promotional_description_removed"]
        : []),
      ...(!extracted.application ? ["application_missing"] : []),
      ...(!extracted.ingredients ? ["ingredients_missing"] : []),
    ],
  };
}
