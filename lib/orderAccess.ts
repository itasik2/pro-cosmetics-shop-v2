import { createHash, createHmac, randomBytes } from "node:crypto";
import { getPublicBaseUrl, getScopedEnv } from "@/lib/siteConfig";

function accessSecret() {
  const configured =
    getScopedEnv("ORDER_ACCESS_SECRET").trim() ||
    getScopedEnv("NEXTAUTH_SECRET").trim();

  if (configured) return configured;

  if (process.env.NODE_ENV !== "production") {
    return "development-only-order-access-secret";
  }

  throw new Error("order_access_secret_not_configured");
}

export function hashOrderAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createOrderAccessToken(seed?: string) {
  const token = seed
    ? createHmac("sha256", accessSecret()).update(`order:${seed}`).digest("hex")
    : randomBytes(32).toString("hex");
  return { token, tokenHash: hashOrderAccessToken(token) };
}

export function orderAccessUrl(token: string) {
  return new URL(
    `/order/${encodeURIComponent(token)}`,
    `${getPublicBaseUrl().replace(/\/$/, "")}/`,
  ).toString();
}
