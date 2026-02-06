import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function isAdminRequest() {
  const session = await auth();
  const adminEmail = (process.env.AUTH_ADMIN_EMAIL || "").toLowerCase().trim();
  const email = (session?.user?.email || "").toLowerCase().trim();

  return !!adminEmail && !!email && email === adminEmail;
}

export async function requireAdmin() {
  if (await isAdminRequest()) return null;

  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
