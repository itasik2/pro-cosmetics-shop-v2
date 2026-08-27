// lib/auth.ts
import { timingSafeEqual } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getScopedEnv } from "@/lib/siteConfig";

function constantTimeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
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
      async authorize(creds) {
        const schema = z.object({
          email: z.string().email(),
          password: z.string().min(3),
        });
        const parsed = schema.safeParse(creds);
        if (!parsed.success) return null;

        const adminEmail = getScopedEnv("AUTH_ADMIN_EMAIL").toLowerCase().trim();
        const adminPass = getScopedEnv("AUTH_ADMIN_PASSWORD");
        if (!adminEmail || !adminPass) return null;

        const normalizedEmail = parsed.data.email.toLowerCase().trim();
        if (
          constantTimeStringEqual(normalizedEmail, adminEmail) &&
          constantTimeStringEqual(parsed.data.password, adminPass)
        ) {
          return { id: "admin", name: "Admin", email: adminEmail, role: "admin" } as any;
        }
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) (token as any).role = (user as any).role === "admin" ? "admin" : "user";
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = (token as any).role === "admin" ? "admin" : "user";
      }
      return session;
    },
  },
  pages: { signIn: "/admin" },
} satisfies Parameters<typeof NextAuth>[0];

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
