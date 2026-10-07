import "server-only";
import { getScopedEnv } from "@/lib/siteConfig";

export type CatalogHubProduct = {
  id: string;
  organizationId: string;
  sku: string;
  barcode: string | null;
  title: string;
  brand: string | null;
  shortDescription: string | null;
  description: string | null;
  application: string | null;
  ingredients: string | null;
  categoryKey: string | null;
  attributes: unknown;
  images: string[];
  purchasePrice: number | null;
  price: number | null;
  totals: {
    stock: number;
    reserved: number;
    safetyStock: number;
    available: number;
  };
  updatedAt: string;
};

export type CatalogHubShadowConfig = {
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  organizationId: string;
  hasApiKey: boolean;
  timeoutMs: number;
};

function boolEnv(value: string, fallback = false) {
  if (!value.trim()) return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function intEnv(value: string, fallback: number, min: number, max: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, parsed))
    : fallback;
}

function normalizeBaseUrl(value: string) {
  const raw = value.trim();
  if (!raw) return "";

  const url = new URL(raw);
  if (url.username || url.password) {
    throw new Error("catalog_hub_url_credentials_not_allowed");
  }

  const localHost = ["localhost", "127.0.0.1", "::1"].includes(
    url.hostname.toLowerCase(),
  );
  const protocolAllowed =
    url.protocol === "https:" ||
    (process.env.NODE_ENV !== "production" && localHost && url.protocol === "http:");

  if (!protocolAllowed) {
    throw new Error("catalog_hub_url_must_use_https");
  }

  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function getCatalogHubShadowConfig(): CatalogHubShadowConfig {
  let baseUrl = "";
  try {
    baseUrl = normalizeBaseUrl(getScopedEnv("CATALOG_HUB_URL"));
  } catch {
    baseUrl = "";
  }

  const organizationId = getScopedEnv("CATALOG_HUB_ORGANIZATION_ID").trim();
  const apiKey = getScopedEnv("CATALOG_HUB_API_KEY").trim();
  const enabled = boolEnv(getScopedEnv("CATALOG_HUB_SHADOW_ENABLED"), false);

  return {
    enabled,
    configured: Boolean(baseUrl && organizationId && apiKey),
    baseUrl,
    organizationId,
    hasApiKey: Boolean(apiKey),
    timeoutMs: intEnv(
      getScopedEnv("CATALOG_HUB_TIMEOUT_MS"),
      5000,
      1000,
      15000,
    ),
  };
}

async function catalogHubFetch<T>(
  path: string,
  options?: {
    authenticated?: boolean;
  },
): Promise<T> {
  const config = getCatalogHubShadowConfig();
  if (!config.baseUrl) throw new Error("catalog_hub_url_not_configured");

  const authenticated = options?.authenticated !== false;
  const apiKey = getScopedEnv("CATALOG_HUB_API_KEY").trim();

  if (authenticated && !apiKey) {
    throw new Error("catalog_hub_api_key_not_configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: authenticated
        ? {
            "x-catalog-hub-key": apiKey,
            accept: "application/json",
          }
        : { accept: "application/json" },
    });

    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      throw new Error(
        `catalog_hub_http_${response.status}:${
          typeof data === "string"
            ? data.slice(0, 300)
            : JSON.stringify(data).slice(0, 300)
        }`,
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("catalog_hub_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getCatalogHubHealth() {
  const [health, ready] = await Promise.allSettled([
    catalogHubFetch<Record<string, unknown>>("/health", {
      authenticated: false,
    }),
    catalogHubFetch<Record<string, unknown>>("/ready", {
      authenticated: false,
    }),
  ]);

  return {
    health:
      health.status === "fulfilled"
        ? { ok: true, data: health.value }
        : { ok: false, error: String(health.reason?.message || health.reason) },
    ready:
      ready.status === "fulfilled"
        ? { ok: true, data: ready.value }
        : { ok: false, error: String(ready.reason?.message || ready.reason) },
  };
}

export async function getCatalogHubProductBySku(sku: string) {
  const config = getCatalogHubShadowConfig();
  if (!config.organizationId) {
    throw new Error("catalog_hub_organization_not_configured");
  }

  const path =
    `/v1/catalog/by-sku/${encodeURIComponent(sku)}?organizationId=` +
    encodeURIComponent(config.organizationId);

  try {
    return await catalogHubFetch<CatalogHubProduct>(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("catalog_hub_http_404:")) return null;
    throw error;
  }
}

function normalizedText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export type LegacyProductComparable = {
  id: string;
  supplierSku: string;
  name: string;
  brandName: string | null;
  shortDescription: string | null;
  description: string;
  price: number;
  sourcePrice: number | null;
  stock: number;
};

export function compareLegacyProductToHub(
  legacy: LegacyProductComparable,
  hub: CatalogHubProduct,
) {
  const comparisons = [
    {
      field: "title",
      legacy: legacy.name,
      hub: hub.title,
      equal: normalizedText(legacy.name) === normalizedText(hub.title),
    },
    {
      field: "brand",
      legacy: legacy.brandName,
      hub: hub.brand,
      equal:
        normalizedText(legacy.brandName).toLowerCase() ===
        normalizedText(hub.brand).toLowerCase(),
    },
    {
      field: "shortDescription",
      legacy: legacy.shortDescription,
      hub: hub.shortDescription,
      equal:
        normalizedText(legacy.shortDescription) ===
        normalizedText(hub.shortDescription),
    },
    {
      field: "description",
      legacy: legacy.description,
      hub: hub.description,
      equal:
        normalizedText(legacy.description) === normalizedText(hub.description),
    },
    {
      field: "price",
      legacy: legacy.price,
      hub: hub.price,
      equal: legacy.price === hub.price,
    },
    {
      field: "purchasePrice",
      legacy: legacy.sourcePrice,
      hub: hub.purchasePrice,
      equal: legacy.sourcePrice === hub.purchasePrice,
    },
    {
      field: "stock",
      legacy: legacy.stock,
      hub: hub.totals.stock,
      equal: legacy.stock === hub.totals.stock,
    },
  ];

  const differences = comparisons.filter((item) => !item.equal);

  return {
    localProductId: legacy.id,
    sku: legacy.supplierSku,
    hubProductId: hub.id,
    matched: differences.length === 0,
    differences,
  };
}
