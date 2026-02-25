import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// ── Type augmentation ────────────────────────────────────────────────────────
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "UPLOADER";
    } & DefaultSession["user"];
  }
}
// ────────────────────────────────────────────────────────────────────────────

const tenantId = process.env.AZURE_AD_TENANT_ID ?? "common";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // ── Credentials (email + password) ──────────────────────────────────────
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, password: true, role: true },
        });

        if (!user?.password) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),

    // ── OAuth providers ──────────────────────────────────────────────────────
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      // Credentials: authorize() already validated — just allow through
      if (account?.provider === "credentials") {
        return !!user;
      }

      // OAuth: check the email exists in the whitelist DB
      const email = profile?.email;
      if (!email) return false;

      const dbUser = await prisma.user.findUnique({ where: { email } });
      if (!dbUser) return "/unauthorized";

      // Backfill name on first OAuth sign-in
      if (!dbUser.name && profile?.name) {
        await prisma.user.update({
          where: { email },
          data: { name: profile.name },
        });
      }

      return true;
    },

    async jwt({ token, user }) {
      // user is only present on first sign-in
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true, role: true },
        });
        if (dbUser) {
          token["id"] = dbUser.id;
          token["role"] = dbUser.role;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token["id"] as string) ?? "";
        session.user.role = ((token["role"] as string) ?? "UPLOADER") as "ADMIN" | "UPLOADER";
      }
      return session;
    },
  },
  session: { strategy: "jwt" },
});
