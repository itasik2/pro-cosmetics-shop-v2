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

function retentionDays() {
  const parsed = Number(getScopedEnv("ORDER_ACCESS_RETENTION_DAYS") || "90");
  if (!Number.isFinite(parsed)) return 90;
  return Math.max(7, Math.min(365, Math.trunc(parsed)));
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

export function isOrderAccessExpired(order: {
  status: string;
  archivedAt?: Date | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
}) {
  const terminal =
    order.status === "DONE" || order.status === "CANCELED" || Boolean(order.archivedAt);
  if (!terminal) return false;

  const reference = order.archivedAt || order.updatedAt || order.createdAt;
  if (!reference) return false;

  return (
    Date.now() - reference.getTime() > retentionDays() * 24 * 60 * 60 * 1000
  );
}

export function orderAccessUrl(token: string) {
  return new URL(
    `/order/${encodeURIComponent(token)}`,
    `${getPublicBaseUrl().replace(/\/$/, "")}/`,
  ).toString();
}
