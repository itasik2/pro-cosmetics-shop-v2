type Bucket = { count: number; resetAt: number };

const globalStore = global as unknown as {
  __rateLimitStore?: Map<string, Bucket>;
};

const store = globalStore.__rateLimitStore ?? new Map<string, Bucket>();
if (!globalStore.__rateLimitStore) globalStore.__rateLimitStore = store;

function cleanup(now: number) {
  if (store.size < 2000) return;
  for (const [key, value] of store.entries()) {
    if (value.resetAt <= now) store.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  cleanup(now);

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

export function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for") || "";
  const xffCandidate = xff.split(",")[0]?.trim();
  if (xffCandidate) return xffCandidate;

  const realIp = (req.headers.get("x-real-ip") || "").trim();
  if (realIp) return realIp;

  const cfIp = (req.headers.get("cf-connecting-ip") || "").trim();
  if (cfIp) return cfIp;

  return null;
}
