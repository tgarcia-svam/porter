import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
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

    // OAuth: email must already exist — only admins can add users
    console.log("[auth] signIn attempt — user:", JSON.stringify(user), "profile:", JSON.stringify(profile));
    const raw = user?.email ?? (profile as Record<string, unknown>)?.preferred_username as string ?? profile?.email;
    console.log("[auth] resolved email:", raw);
    if (!raw) return false;
    const email = raw.toLowerCase();

    const dbUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    console.log("[auth] DB lookup for", email, "→", dbUser ? `found (id=${dbUser.id})` : "NOT FOUND");
    if (!dbUser) return false;

    // Backfill name from OAuth profile on first sign-in
    const name = profile?.name ?? user?.name;
    if (!dbUser.name && name) {
      await prisma.user.update({ where: { id: dbUser.id }, data: { name } });
    }
    return true;
  },

  async jwt({ token, user, profile }) {
    // user is only present on first sign-in
    if (user) {
      const email =
        user?.email ??
        (profile as Record<string, unknown>)?.preferred_username as string | undefined ??
        profile?.email;
      console.log("[auth] jwt — resolved email:", email, "token.preferred_username:", token["preferred_username"]);
      if (email) {
        const dbUser = await prisma.user.findFirst({
          where: { email: { equals: email.toLowerCase(), mode: "insensitive" } },
          select: { id: true, role: true },
        });
        console.log("[auth] jwt DB lookup for", email, "→", dbUser ? `id=${dbUser.id}` : "NOT FOUND");
        if (dbUser) {
          token["id"] = dbUser.id;
          token["role"] = dbUser.role;
        }
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

  const providers: NextAuthConfig["providers"] = [];

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
    session: { strategy: "jwt", maxAge: 30 * 60 }, // 30 minutes
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
