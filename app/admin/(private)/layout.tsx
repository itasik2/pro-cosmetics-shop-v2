// app/admin/(private)/layout.tsx
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";

export default async function AdminPrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAdmin = (session?.user as any)?.role === "admin";

  if (!isAdmin) redirect("/admin");

  return <AdminShell>{children}</AdminShell>;
}
