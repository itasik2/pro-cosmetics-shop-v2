import { createHash, createHmac, randomBytes } from "node:crypto";
import { getPublicBaseUrl } from "@/lib/siteConfig";

function accessSecret() {
  return (
    process.env.ORDER_ACCESS_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "development-only-order-access-secret"
  );
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
