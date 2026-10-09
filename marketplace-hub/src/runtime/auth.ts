import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

export type CatalogHubAuthConfig = {
  required: boolean;
  configured: boolean;
  apiKey: string;
};

function boolEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

export function getCatalogHubAuthConfig(): CatalogHubAuthConfig {
  const apiKey = String(process.env.CATALOG_HUB_API_KEY || "").trim();
  const required = boolEnv(
    process.env.CATALOG_HUB_AUTH_REQUIRED,
    process.env.NODE_ENV === "production",
  );

  return {
    required,
    configured: Boolean(apiKey),
    apiKey,
  };
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function presentedKey(request: FastifyRequest) {
  const direct = String(request.headers["x-catalog-hub-key"] || "").trim();
  if (direct) return direct;

  const authorization = String(request.headers.authorization || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function isCatalogHubRequestAuthorized(
  request: FastifyRequest,
  config = getCatalogHubAuthConfig(),
) {
  if (!config.required) return true;
  if (!config.configured) return false;

  const candidate = presentedKey(request);
  return Boolean(candidate && safeEqual(candidate, config.apiKey));
}
