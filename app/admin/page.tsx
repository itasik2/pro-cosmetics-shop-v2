// app/admin/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminLoginClient from "./AdminLoginClient";

export default async function AdminPage() {
  const session = await auth();
  const isAdmin = (session?.user as any)?.role === "admin";

  if (isAdmin) {
    redirect("/admin/products");
  }

  return <AdminLoginClient />;
}
