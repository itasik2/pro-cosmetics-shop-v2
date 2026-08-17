import { createHash, randomBytes } from "node:crypto";
import { getPublicBaseUrl } from "@/lib/siteConfig";

export function hashOrderAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createOrderAccessToken() {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashOrderAccessToken(token) };
}

export function orderAccessUrl(token: string) {
  return new URL(
    `/order/${encodeURIComponent(token)}`,
    `${getPublicBaseUrl().replace(/\/$/, "")}/`,
  ).toString();
}
