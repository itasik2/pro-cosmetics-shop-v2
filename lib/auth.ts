// lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getScopedEnv } from "@/lib/siteConfig";

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

        if (
          parsed.data.email.toLowerCase().trim() === adminEmail &&
          parsed.data.password === adminPass
        ) {
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
