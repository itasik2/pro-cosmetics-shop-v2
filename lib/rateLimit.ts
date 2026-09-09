import { isIP } from "node:net";
import { prisma } from "@/lib/prisma";

type Bucket = { count: number; resetAt: number };
type DbBucket = { count: number; resetAt: Date };

const globalStore = global as unknown as {
  __rateLimitStore?: Map<string, Bucket>;
  __rateLimitDbWarningShown?: boolean;
  __rateLimitCleanupAt?: number;
};

const store = globalStore.__rateLimitStore ?? new Map<string, Bucket>();
if (!globalStore.__rateLimitStore) globalStore.__rateLimitStore = store;

function cleanupMemory(now: number) {
  if (store.size < 2000) return;
  for (const [key, value] of store.entries()) {
    if (value.resetAt <= now) store.delete(key);
  }
}

function memoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  cleanupMemory(now);

  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    ok: true,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

async function cleanupDatabase(now: Date) {
  const nowMs = now.getTime();
  const lastCleanup = globalStore.__rateLimitCleanupAt ?? 0;
  if (nowMs - lastCleanup < 60 * 60 * 1000) return;
  globalStore.__rateLimitCleanupAt = nowMs;

  const cutoff = new Date(nowMs - 24 * 60 * 60 * 1000);
  await prisma.$executeRaw`
    DELETE FROM "RateLimitBucket"
    WHERE "resetAt" < ${cutoff}
  `;
}

async function databaseRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const now = new Date();
  const nextResetAt = new Date(now.getTime() + windowMs);

  const rows = await prisma.$queryRaw<DbBucket[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${nextResetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${nextResetAt}
        ELSE "RateLimitBucket"."resetAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "resetAt"
  `;

  void cleanupDatabase(now).catch(() => undefined);

  const row = rows[0];
  if (!row) return memoryRateLimit(key, limit, windowMs);

  const retryAfterSec = Math.max(
    1,
    Math.ceil((new Date(row.resetAt).getTime() - now.getTime()) / 1000),
  );

  return {
    ok: row.count <= limit,
    retryAfterSec,
  };
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const safeWindowMs = Math.max(1000, Math.trunc(windowMs));
  const safeKey = String(key || "unknown").slice(0, 300);

  try {
    return await databaseRateLimit(safeKey, safeLimit, safeWindowMs);
  } catch (error) {
    if (!globalStore.__rateLimitDbWarningShown) {
      globalStore.__rateLimitDbWarningShown = true;
      console.error(
        "RATE LIMIT DATABASE FALLBACK:",
        error instanceof Error ? error.message : "unknown_error",
      );
    }
    return memoryRateLimit(safeKey, safeLimit, safeWindowMs);
  }
}

function normalizeIp(value: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (isIP(raw)) return raw;

  const bracketed = raw.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed && isIP(bracketed[1])) return bracketed[1];

  const ipv4WithPort = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort && isIP(ipv4WithPort[1])) return ipv4WithPort[1];

  return null;
}

function firstValidForwardedIp(value: string | null) {
  for (const item of String(value || "").split(",")) {
    const ip = normalizeIp(item);
    if (ip) return ip;
  }
  return null;
}

export function getClientIp(req: Request): string | null {
  return (
    firstValidForwardedIp(req.headers.get("x-vercel-forwarded-for")) ||
    normalizeIp(req.headers.get("cf-connecting-ip")) ||
    normalizeIp(req.headers.get("x-real-ip")) ||
    firstValidForwardedIp(req.headers.get("x-forwarded-for"))
  );
}
