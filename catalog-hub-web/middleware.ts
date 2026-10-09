import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/session", "/api/health"];

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PATHS.some((prefix) => path === prefix || path.startsWith(prefix + "/"))) {
    return NextResponse.next();
  }

  const token = String(process.env.CATALOG_HUB_UI_SESSION_TOKEN || "");
  if (!token) {
    if (process.env.NODE_ENV === "development") return NextResponse.next();
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "session_not_configured");
    return NextResponse.redirect(url);
  }

  if (request.cookies.get("catalog_hub_session")?.value === token) {
    return NextResponse.next();
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
