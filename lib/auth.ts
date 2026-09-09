// lib/auth.ts
import { createHash, timingSafeEqual } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { recordSecurityAudit } from "@/lib/securityAudit";
import { getScopedEnv } from "@/lib/siteConfig";

const ADMIN_LOGIN_LIMIT = 10;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_SESSION_MAX_AGE_SEC = 8 * 60 * 60;

function safeSecretEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export const authConfig = {
  trustHost: true,
  session: {
    strategy: "jwt" as const,
    maxAge: ADMIN_SESSION_MAX_AGE_SEC,
  },
  jwt: { maxAge: ADMIN_SESSION_MAX_AGE_SEC },
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

        const attemptedEmail = parsed.data.email.toLowerCase().trim();
        const clientIp = getClientIp(request) ?? "unknown";
        const rateLimit = await checkRateLimit(
          `admin-login:${clientIp}`,
          ADMIN_LOGIN_LIMIT,
          ADMIN_LOGIN_WINDOW_MS,
        );
        if (!rateLimit.ok) {
          await recordSecurityAudit({
            eventType: "ADMIN_LOGIN",
            outcome: "DENIED",
            clientIp,
            subject: attemptedEmail,
            metadata: { reason: "rate_limited" },
          });
          return null;
        }

        const adminEmail = getScopedEnv("AUTH_ADMIN_EMAIL").toLowerCase().trim();
        const adminPass = getScopedEnv("AUTH_ADMIN_PASSWORD");

        if (!adminEmail || !adminPass) {
          await recordSecurityAudit({
            eventType: "ADMIN_LOGIN",
            outcome: "ERROR",
            clientIp,
            subject: attemptedEmail,
            metadata: { reason: "admin_credentials_not_configured" },
          });
          return null;
        }

        const emailMatches = attemptedEmail === adminEmail;
        const passwordMatches = safeSecretEqual(parsed.data.password, adminPass);

        if (emailMatches && passwordMatches) {
          await recordSecurityAudit({
            eventType: "ADMIN_LOGIN",
            outcome: "SUCCESS",
            clientIp,
            subject: attemptedEmail,
          });
          return { id: "admin", name: "Admin", email: adminEmail, role: "admin" } as any;
        }

        await recordSecurityAudit({
          eventType: "ADMIN_LOGIN",
          outcome: "DENIED",
          clientIp,
          subject: attemptedEmail,
          metadata: { reason: "credential_mismatch" },
        });
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user && (user as any).role === "admin") {
        (token as any).role = "admin";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role =
          (token as any).role === "admin" ? "admin" : undefined;
      }
      return session;
    },
  },
  pages: { signIn: "/admin" },
} satisfies Parameters<typeof NextAuth>[0];

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
