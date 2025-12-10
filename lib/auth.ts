// lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

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

        const adminEmail = (process.env.AUTH_ADMIN_EMAIL || "").toLowerCase();
        const adminPass = process.env.AUTH_ADMIN_PASSWORD || "";

        if (
          parsed.data.email.toLowerCase() === adminEmail &&
          parsed.data.password === adminPass
        ) {
          return { id: "admin", name: "Admin", email: adminEmail, role: "admin" };
        }
        return null; // пускаем только админа
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // @ts-ignore
        token.role = (user as any).role || "admin";
      }
      return token;
    },
    async session({ session, token }) {
      // @ts-ignore
      session.user.role = (token as any).role || "admin";
      return session;
    },
  },
  pages: {signIn: "/admin"},
} satisfies Parameters<typeof NextAuth>[0];

// ... существующий код lib/auth.ts

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

// ЯВНО экспортируем method handlers — удобно для роут-файла
export const GET = handlers.GET;
export const POST = handlers.POST;

