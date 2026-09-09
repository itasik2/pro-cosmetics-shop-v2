import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CUID_RE = /^c[a-z0-9]{20,}$/i;

function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cloud.umami.is https://epay.homebank.kz https://test-epay.epayment.kz${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https://cloud.umami.is https://*.homebank.kz https://*.epayment.kz",
    "frame-src 'self' https://*.homebank.kz https://*.epayment.kz",
    "form-action 'self' https://*.homebank.kz https://*.epayment.kz",
    "worker-src 'self' blob:",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const { pathname } = req.nextUrl;
  let response: NextResponse;

  if (pathname.startsWith("/shop/")) {
    const value = pathname.slice("/shop/".length);
    if (value && !value.includes("/") && CUID_RE.test(value)) {
      const url = req.nextUrl.clone();
      url.pathname = `/api/products/by-id-redirect/${value}`;
      response = NextResponse.rewrite(url, {
        request: { headers: requestHeaders },
      });
      response.headers.set("Content-Security-Policy", csp);
      return response;
    }
  }

  response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
