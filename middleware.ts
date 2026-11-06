import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isLocalizablePath, localeInPath, parseSiteLocale, SITE_LOCALE_COOKIE, stripLocale } from "@/lib/i18n";

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
    "connect-src 'self' https://cloud.umami.is https://gateway.umami.is https://*.homebank.kz https://*.epayment.kz",
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
  const prefixLocale = localeInPath(pathname);
  const cookieLocale = parseSiteLocale(req.cookies.get(SITE_LOCALE_COOKIE)?.value);
  const requestLocale = prefixLocale || "ru";

  // A language preference follows normal internal links without altering the
  // existing Russian URLs for visitors and search engines without a cookie.
  if (!prefixLocale && cookieLocale !== "ru" && req.method === "GET" &&
      isLocalizablePath(pathname)) {
    const target = req.nextUrl.clone();
    target.pathname = "/" + cookieLocale + (pathname === "/" ? "" : pathname);
    const redirected = NextResponse.redirect(target);
    redirected.headers.set("Content-Security-Policy", csp);
    return redirected;
  }

  requestHeaders.set("x-site-locale", requestLocale);
  const visiblePath = prefixLocale ? stripLocale(pathname) : pathname;
  const target = req.nextUrl.clone();
  target.pathname = visiblePath;

  if (visiblePath.startsWith("/shop/")) {
    const value = visiblePath.slice("/shop/".length);
    if (value && !value.includes("/") && CUID_RE.test(value)) {
      target.pathname = `/api/products/by-id-redirect/${value}`;
    }
  }

  const response = prefixLocale && isLocalizablePath(pathname)
    ? NextResponse.rewrite(target, { request: { headers: requestHeaders } })
    : target.pathname !== pathname
      ? NextResponse.rewrite(target, { request: { headers: requestHeaders } })
      : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Content-Language", requestLocale);
  if (prefixLocale && isLocalizablePath(pathname)) {
    response.cookies.set(SITE_LOCALE_COOKIE, prefixLocale, {
      path: "/", maxAge: 31536000, sameSite: "lax", secure: req.nextUrl.protocol === "https:",
    });
    // Do not index mixed-language product descriptions until translations
    // are reviewed. Existing Russian canonical pages stay indexable.
    response.headers.set("X-Robots-Tag", "noindex, follow");
  }
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
