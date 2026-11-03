/** Authorization is resolved by the server before any domain handler runs. */
export type Principal = {
  actor: string;
  organizationId: string;
  scopes: string[];
};

export class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const areas: Array<[RegExp, string]> = [
  [/^\/v1\/(?:catalog|categories|staging)(?:\/|$)/, "catalog"],
  [/^\/v1\/(?:suppliers|price-import|imports)(?:\/|$)/, "imports"],
  [/^\/v1\/(?:inventory|reservations)(?:\/|$)/, "inventory"],
  [/^\/v1\/orders(?:\/|$)/, "orders"],
  [/^\/v1\/channels(?:\/|$)/, "channels"],
  [/^\/v1\/repricing(?:\/|$)/, "pricing"],
  [/^\/v1\/(?:ai|source-policies|media)(?:\/|$)/, "enrichment"],
  [/^\/v1\/(?:ui|audit|sync)(?:\/|$)/, "operations"],
];

export function requiredScope(route: string, method: string): string | null {
  if(method==="POST"&&/^\/v1\/channels\/[A-Za-z0-9_-]+\/shadow-preview$/.test(route))return "channels:read";
  const channelEvent=route.match(/^\/v1\/channels\/([A-Za-z0-9_-]+)\/order-events(?:\/preview)?$/);
  if(channelEvent&&method==="POST")return "orders:write:"+channelEvent[1];
  const area = areas.find(([pattern]) => pattern.test(route))?.[1];
  if (!area) return null;
  return area + (method === "GET" || method === "HEAD" ? ":read" : ":write");
}

export function assertScope(principal: Principal, route: string, method: string) {
  const scope = requiredScope(route, method);
  if (!scope || !principal.scopes.some(s => s === "*" || s === scope || (scope.startsWith("orders:write:")&&s==="orders:write"))) {
    throw new RequestError("scope_forbidden", 403);
  }
}

function assertOrganization(value: unknown, organizationId: string, depth = 0) {
  if (depth > 30) throw new RequestError("body_too_deep");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "organizationId" && child !== organizationId) {
      throw new RequestError("organization_forbidden", 403);
    }
    assertOrganization(child, organizationId, depth + 1);
  }
}

// Bound while reading, including chunked requests without Content-Length.
export async function boundedJson(req: Request, maxBytes = 1024 * 1024): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length") || 0) > maxBytes) {
    throw new RequestError("payload_too_large", 413);
  }
  if (!req.body) throw new RequestError("invalid_body");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestError("payload_too_large", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestError("invalid_body"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("invalid_body");
  return value as Record<string, unknown>;
}

export async function scopeRequest(req: Request, url: URL, principal: Principal): Promise<Request> {
  for (const value of url.searchParams.getAll("organizationId")) {
    if (value !== principal.organizationId) throw new RequestError("organization_forbidden", 403);
  }
  url.searchParams.set("organizationId", principal.organizationId);
  if (req.method === "GET" || req.method === "HEAD" || !req.body) return req;
  const body = await boundedJson(req);
  assertOrganization(body, principal.organizationId);
  body.organizationId = principal.organizationId;
  if (Array.isArray(body.items)) {
    body.items = body.items.map(item => item && typeof item === "object" && !Array.isArray(item)
      ? { ...item, organizationId: principal.organizationId } : item);
  }
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  return new Request(req.url, { method: req.method, headers, body: JSON.stringify(body) });
}

export function legacyOrganization(ids: string[]): string | null {
  // A legacy key is never a cross-tenant administrator. Once a second tenant
  // exists, every credential and the web deployment must be explicitly bound.
  return ids.length === 1 ? ids[0] : null;
}
