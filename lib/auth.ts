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

        const adminEmail = process.env.AUTH_ADMIN_EMAIL;
        const adminPass = process.env.AUTH_ADMIN_PASSWORD;

        if (
          parsed.data.email === adminEmail &&
          parsed.data.password === adminPass
        ) {
          return { id: "admin", name: "Admin", email: adminEmail };
        }
        return null;
      },
    }),
  ],
  // опционально, чтобы ошибки не сыпались в прод:
  pages: {},
} satisfies Parameters<typeof NextAuth>[0];
