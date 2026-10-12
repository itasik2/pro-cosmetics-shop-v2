import "server-only";
import { headers } from "next/headers";
import { isLocalReadOnly, isMutation } from "./local-mode";

const baseUrl = String(process.env.CATALOG_HUB_API_URL || "").replace(/\/$/, "");
const apiKey = String(process.env.CATALOG_HUB_API_KEY || "");
async function getRequestOidcToken() {
  try {
    // Vercel supplies its short-lived runtime token in the request headers.
    const requestHeaders = await headers();
    return requestHeaders.get("x-vercel-oidc-token") || "";
  } catch {
    // Outside a request (e.g. local tooling), use the optional dev token.
    return "";
  }
}
export const organizationId =
  String(process.env.CATALOG_HUB_ORGANIZATION_ID || "") || "org_procosmetics";
export const warehouseId =
  String(process.env.CATALOG_HUB_WAREHOUSE_ID || "") || "wh_pav_01";

export type HubProduct = {
  id: string;
  organizationId: string;
  sku: string;
  barcode: string | null;
  title: string;
  brand: string | null;
  shortDescription?: string | null;
  description: string | null;
  application?: string | null;
  ingredients?: string | null;
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
  inventory?: {
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
    onHand: number;
    reserved: number;
    safetyStock: number;
    available: number;
  }[];
  createdAt: string;
  updatedAt: string;
};

export type HubList<T> = {
  items: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
};

export async function hubFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (isLocalReadOnly() && isMutation(init?.method)) {
    throw new Error("local_read_only_mode: изменение данных отключено. Используйте тестовый проект Supabase и осознанно включите CATALOG_HUB_LOCAL_WRITE_ENABLED=true.");
  }
  if (!baseUrl) throw new Error("CATALOG_HUB_API_URL not configured");
  // Local requests cannot obtain a Vercel-signed runtime identity.
  // Prefer the explicitly configured Catalog Hub key, even if an old
  // VERCEL_OIDC_TOKEN leaked into the local shell environment.
  const oidcToken = process.env.NODE_ENV === "development"
    ? ""
    : (await getRequestOidcToken()) || String(process.env.VERCEL_OIDC_TOKEN || "");
  if (!oidcToken && !apiKey && path.startsWith("/v1/")) {
    throw new Error("catalog_hub_server_auth_not_configured");
  }

  const response = await fetch(baseUrl + path, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(oidcToken
        ? { authorization: `Bearer ${oidcToken}` }
        : apiKey
          ? { "x-catalog-hub-key": apiKey }
          : {}),
      ...(init?.headers || {}),
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const reason =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "http_" + response.status;
    throw new Error(reason);
  }
  return body as T;
}

export async function safeHub<T>(request: Promise<T>) {
  try {
    return { ok: true as const, data: await request, error: null };
  } catch (error) {
    return {
      ok: false as const,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function catalogPath(params?: {
  q?: string;
  limit?: number;
  offset?: number;
}) {
  const search = new URLSearchParams({
    organizationId,
    limit: String(params?.limit ?? 50),
    offset: String(params?.offset ?? 0),
  });
  if (params?.q) search.set("q", params.q);
  return "/v1/catalog/products?" + search.toString();
}
