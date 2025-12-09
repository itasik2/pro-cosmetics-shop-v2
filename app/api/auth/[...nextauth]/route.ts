// app/api/auth/[...nextauth]/route.ts
export const runtime = "nodejs";
export { handlers as GET, handlers as POST } from "@/lib/auth";
