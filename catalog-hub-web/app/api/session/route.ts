import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expectedPassword = String(process.env.CATALOG_HUB_UI_PASSWORD || "");
  const sessionToken = String(process.env.CATALOG_HUB_UI_SESSION_TOKEN || "");

  if (!expectedPassword || !sessionToken) {
    return NextResponse.json({ error: "ui_auth_not_configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!equal(password, expectedPassword)) {
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("catalog_hub_session", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("catalog_hub_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
