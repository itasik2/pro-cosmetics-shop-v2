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
  const adminEmail = (process.env.AUTH_ADMIN_EMAIL || "").toLowerCase();

  if (!session?.user?.email || session.user.email.toLowerCase() !== adminEmail) {
    redirect("/admin"); // если не админ — на страницу логина
  }

  return <AdminShell>{children}</AdminShell>;
}
