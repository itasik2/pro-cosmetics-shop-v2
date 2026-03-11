import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CUID_RE = /^c[a-z0-9]{20,}$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/shop/")) {
    return NextResponse.next();
  }

  const value = pathname.slice("/shop/".length);

  if (!value || value.includes("/")) {
    return NextResponse.next();
  }

  // Если это не похоже на старый id, пропускаем как slug
  if (!CUID_RE.test(value)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = `/api/products/by-id-redirect/${value}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/shop/:path*"],
};
