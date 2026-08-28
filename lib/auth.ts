// lib/auth.ts
import { createHash, timingSafeEqual } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { getScopedEnv } from "@/lib/siteConfig";

const ADMIN_LOGIN_LIMIT = 10;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

function safeSecretEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" as const },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds, request) {
        const schema = z.object({
          email: z.string().email(),
          password: z.string().min(3).max(512),
        });
        const parsed = schema.safeParse(creds);
        if (!parsed.success) return null;

        const clientIp = getClientIp(request) ?? "unknown";
        const rateLimit = checkRateLimit(
          `admin-login:${clientIp}`,
          ADMIN_LOGIN_LIMIT,
          ADMIN_LOGIN_WINDOW_MS,
        );
        if (!rateLimit.ok) return null;

        const adminEmail = getScopedEnv("AUTH_ADMIN_EMAIL").toLowerCase().trim();
        const adminPass = getScopedEnv("AUTH_ADMIN_PASSWORD");

        if (!adminEmail || !adminPass) return null;

        const emailMatches =
          parsed.data.email.toLowerCase().trim() === adminEmail;
        const passwordMatches = safeSecretEqual(parsed.data.password, adminPass);

        if (emailMatches && passwordMatches) {
          return { id: "admin", name: "Admin", email: adminEmail, role: "admin" } as any;
        }
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) (token as any).role = (user as any).role || "admin";
      return token;
    },
    async session({ session, token }) {
      (session.user as any).role = (token as any).role || "admin";
      return session;
    },
  },
  pages: { signIn: "/admin" },
} satisfies Parameters<typeof NextAuth>[0];

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
