// app/admin/(private)/layout.tsx
export const runtime = "nodejs";

import { redirect } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { isAdminRequest } from "@/lib/adminGuard";

export default async function AdminPrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAdminRequest())) redirect("/admin");

  return <AdminShell>{children}</AdminShell>;
}
