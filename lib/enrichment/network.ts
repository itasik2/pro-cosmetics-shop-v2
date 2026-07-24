import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type AllowedSourcePolicy = {
  domain: string;
  allowSubdomains: boolean;
};

type SafeFetchOptions = {
  policies: AllowedSourcePolicy[];
  maxBytes: number;
  acceptedContentTypes: string[];
  timeoutMs?: number;
  maxRedirects?: number;
};

export type SafeFetchResult = {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
};

const USER_AGENT =
  "ProCosmeticsSourceMonitor/1.0 (+https://procosmetics.kz; admin-managed sources)";

function normalizeHostname(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function isAllowedHostname(hostname: string, policies: AllowedSourcePolicy[]) {
  const normalized = normalizeHostname(hostname);

  return policies.some((policy) => {
    const domain = normalizeHostname(policy.domain);
    return (
      normalized === domain ||
      (policy.allowSubdomains && normalized.endsWith(`.${domain}`))
    );
  });
}

function parseIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts;
}

function isBlockedIpv4(address: string) {
  const parts = parseIpv4(address);
  if (!parts) return true;

  const [a, b, c, d] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

function isBlockedIpv6(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8")) return true;

  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  return false;
}

function isBlockedAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

async function assertSafeUrl(
  rawUrl: string,
  policies: AllowedSourcePolicy[],
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid_source_url");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("unsupported_source_protocol");
  }
  if (url.username || url.password) {
    throw new Error("source_credentials_not_allowed");
  }
  if (
    (url.protocol === "https:" && url.port && url.port !== "443") ||
    (url.protocol === "http:" && url.port && url.port !== "80")
  ) {
    throw new Error("source_port_not_allowed");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || !isAllowedHostname(hostname, policies)) {
    throw new Error("source_domain_not_allowed");
  }

  if (isIP(hostname) && isBlockedAddress(hostname)) {
    throw new Error("source_ip_blocked");
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("source_dns_not_found");
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new Error("source_dns_blocked");
  }

  url.hash = "";
  return url;
}

async function readLimitedBody(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("source_response_too_large");
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("source_response_too_large");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function safeFetchExternal(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 12_000);
  const maxRedirects = Math.min(5, Math.max(0, options.maxRedirects ?? 3));
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const url = await assertSafeUrl(currentUrl, options.policies);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: options.acceptedContentTypes.join(", "),
        },
      });
    } catch (error: any) {
      if (error?.name === "AbortError") throw new Error("source_timeout");
      throw new Error(`source_fetch_failed:${String(error?.message || error)}`);
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount >= maxRedirects) {
        throw new Error("source_too_many_redirects");
      }
      const location = response.headers.get("location");
      if (!location) throw new Error("source_redirect_without_location");
      currentUrl = new URL(location, url).toString();
      continue;
    }

    const contentType = (response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();

    if (!response.ok) {
      throw new Error(`source_http_${response.status}`);
    }
    if (
      !options.acceptedContentTypes.some(
        (type) => contentType === type || contentType.startsWith(`${type}+`),
      )
    ) {
      throw new Error(`source_content_type_not_allowed:${contentType || "unknown"}`);
    }

    const buffer = await readLimitedBody(response, options.maxBytes);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      buffer,
      contentType,
      finalUrl: url.toString(),
      status: response.status,
      headers,
    };
  }

  throw new Error("source_fetch_failed");
}

export function safeFetchHtml(
  url: string,
  policies: AllowedSourcePolicy[],
) {
  return safeFetchExternal(url, {
    policies,
    maxBytes: 2 * 1024 * 1024,
    acceptedContentTypes: ["text/html", "application/xhtml+xml"],
    timeoutMs: 12_000,
    maxRedirects: 3,
  });
}

export function safeFetchImage(
  url: string,
  policies: AllowedSourcePolicy[],
) {
  return safeFetchExternal(url, {
    policies,
    maxBytes: 10 * 1024 * 1024,
    acceptedContentTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
    ],
    timeoutMs: 15_000,
    maxRedirects: 3,
  });
}
