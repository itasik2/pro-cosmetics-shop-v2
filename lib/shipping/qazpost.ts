import { getScopedEnv } from "@/lib/siteConfig";

export const QAZPOST_PROVIDER = "QAZPOST";

export type QazPostAddressCandidate = {
  postcode: string;
  address: string;
  addressRus?: string;
  addressKaz?: string;
  addressLat?: string;
};

function config() {
  return {
    token: getScopedEnv("QAZPOST_API_TOKEN").trim(),
    baseUrl: (getScopedEnv("QAZPOST_API_BASE_URL").trim() || "https://open.post.kz").replace(/\/$/, ""),
  };
}

export function isQazPostApiConfigured() {
  return Boolean(config().token);
}

export function qazPostTrackingUrl(trackingNumber: string) {
  const value = String(trackingNumber || "").trim();
  if (!value) return "";
  return `https://post.kz/services/postal/${encodeURIComponent(value)}`;
}

export async function searchQazPostAddress(query: string): Promise<QazPostAddressCandidate[]> {
  const value = String(query || "").replace(/\s+/g, " ").trim();
  if (value.length < 3) return [];

  const { token, baseUrl } = config();
  if (!token) throw new Error("qazpost_not_configured");

  const url = new URL("/npi-integration/api/npi/search", `${baseUrl}/`);
  url.searchParams.set("query", value);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });

  if (response.status === 204) return [];
  if (!response.ok) {
    throw new Error(`qazpost_address_http_${response.status}`);
  }

  const body = (await response.json().catch(() => ({}))) as {
    data?: Array<{
      postcode?: unknown;
      address?: unknown;
      addressRus?: unknown;
      addressKaz?: unknown;
      addressLat?: unknown;
    }>;
  };

  return (Array.isArray(body.data) ? body.data : [])
    .map((item) => ({
      postcode: String(item.postcode || "").trim(),
      address: String(item.addressRus || item.address || item.addressKaz || item.addressLat || "").trim(),
      addressRus: item.addressRus ? String(item.addressRus) : undefined,
      addressKaz: item.addressKaz ? String(item.addressKaz) : undefined,
      addressLat: item.addressLat ? String(item.addressLat) : undefined,
    }))
    .filter((item) => item.address)
    .slice(0, 8);
}
