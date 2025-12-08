// app/api/auth/[...nextauth]/route.ts
export const runtime = "nodejs";

import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth";

// v5 beta API: получаем handlers и экспортируем по методам
const { handlers } = NextAuth(authConfig);

export const GET = handlers.GET;
export const POST = handlers.POST;
