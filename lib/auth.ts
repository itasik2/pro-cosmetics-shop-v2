import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const adminEmail = process.env.AUTH_ADMIN_EMAIL;
        const adminPass = process.env.AUTH_ADMIN_PASSWORD;
        if (
          credentials?.email === adminEmail &&
          credentials?.password === adminPass
        ) {
          return { id: "admin", name: "Admin", email: adminEmail, role: "admin" };
        }
        // simple user without persistence
        if (credentials?.email) {
          return { id: "user", name: "User", email: credentials.email, role: "user" };
        }
        return null;
      }
    })
  ],
  session: { strategy: "jwt" },
});
