import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
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

// Shared callbacks — independent of which providers are configured
const callbacks: NextAuthConfig["callbacks"] = {
  async signIn({ user, account, profile }) {
    // Credentials: authorize() already validated — just allow through
    if (account?.provider === "credentials") return !!user;

    // OAuth: email must exist in the user whitelist
    const email = profile?.email;
    if (!email) return false;

    const dbUser = await prisma.user.findUnique({ where: { email } });
    if (!dbUser) return "/unauthorized";

    // Backfill name on first OAuth sign-in
    if (!dbUser.name && profile?.name) {
      await prisma.user.update({ where: { email }, data: { name: profile.name } });
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
      session.user.role = ((token["role"] as string) ?? "UPLOADER") as
        | "ADMIN"
        | "UPLOADER";
    }
    return session;
  },
};

// ── Lazy singleton ────────────────────────────────────────────────────────────
// The NextAuth instance is built asynchronously on first use, reading SSO
// credentials from AppSetting (DB) first, falling back to env vars.
// Call invalidateAuth() after saving SSO settings so the next request
// rebuilds the instance with the new values — no server restart needed.

type AuthInstance = ReturnType<typeof NextAuth>;
let _promise: Promise<AuthInstance> | null = null;

async function buildInstance(): Promise<AuthInstance> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "AZURE_AD_CLIENT_ID",
          "AZURE_AD_CLIENT_SECRET",
          "AZURE_AD_TENANT_ID",
        ],
      },
    },
  });
  const db = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  const googleId     = db.GOOGLE_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID;
  const googleSecret = db.GOOGLE_CLIENT_SECRET  ?? process.env.GOOGLE_CLIENT_SECRET;
  const msId         = db.AZURE_AD_CLIENT_ID    ?? process.env.AZURE_AD_CLIENT_ID;
  const msSecret     = db.AZURE_AD_CLIENT_SECRET ?? process.env.AZURE_AD_CLIENT_SECRET;
  const msTenant     = db.AZURE_AD_TENANT_ID    ?? process.env.AZURE_AD_TENANT_ID ?? "common";

  const providers: NextAuthConfig["providers"] = [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email    = credentials?.email    as string | undefined;
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
  ];

  if (googleId && googleSecret) {
    providers.push(Google({ clientId: googleId, clientSecret: googleSecret }));
  }

  if (msId && msSecret) {
    providers.push(
      MicrosoftEntraID({
        clientId: msId,
        clientSecret: msSecret,
        issuer: `https://login.microsoftonline.com/${msTenant}/v2.0`,
      })
    );
  }

  return NextAuth({
    providers,
    pages: { signIn: "/login", error: "/login" },
    callbacks,
    session: { strategy: "jwt" },
  });
}

function getInstance(): Promise<AuthInstance> {
  if (!_promise) _promise = buildInstance();
  return _promise;
}

/** Invalidate the cached NextAuth instance. Call after saving SSO settings. */
export function invalidateAuth(): void {
  _promise = null;
}

// ── Proxy exports ─────────────────────────────────────────────────────────────

export const handlers = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GET: async (req: any) => (await getInstance()).handlers.GET(req),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  POST: async (req: any) => (await getInstance()).handlers.POST(req),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auth: AuthInstance["auth"] = ((...args: any[]) =>
  getInstance().then(
    (i) => (i.auth as (...a: typeof args) => unknown)(...args)
  )) as AuthInstance["auth"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const signIn: AuthInstance["signIn"] = ((...args: any[]) =>
  getInstance().then((i) => i.signIn(...args))) as AuthInstance["signIn"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const signOut: AuthInstance["signOut"] = ((...args: any[]) =>
  getInstance().then((i) => i.signOut(...args))) as AuthInstance["signOut"];
