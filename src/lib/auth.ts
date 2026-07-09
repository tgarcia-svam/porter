import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
// Authentication runs before any user/org context exists, so it must bypass RLS.
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { logAuthEvent } from "@/lib/auth-audit";
import { requestStore, hashUa } from "@/lib/session-binding";
import { verifyLoginTicket } from "@/lib/login-ticket";

// ── Type augmentation ────────────────────────────────────────────────────────
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "UPLOADER";
      uaHash?: string; // session binding — UA hash captured at sign-in
    } & DefaultSession["user"];
  }
}
// ────────────────────────────────────────────────────────────────────────────

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS  = 30 * 60 * 1000; // 30 minutes

// Shared callbacks — independent of which providers are configured
const callbacks: NextAuthConfig["callbacks"] = {
  async signIn({ user, account, profile }) {
    // Credentials: authorize() already validated — just allow through
    if (account?.provider === "credentials") return !!user;

    // OAuth: email must already exist — only admins can add users
    const raw = user?.email ?? (profile as Record<string, unknown>)?.preferred_username as string ?? profile?.email;
    if (!raw) return false;
    const email = raw.toLowerCase();

    const dbUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });

    if (!dbUser) {
      logAuthEvent({ action: "auth.login.failed", userEmail: email });
      return false;
    }

    // Enforce the admin's chosen sign-in method: a PASSWORD account must not be
    // able to authenticate via an SSO provider (and vice-versa — the credentials
    // path checks authMethod === PASSWORD before issuing a login ticket).
    if (dbUser.authMethod === "PASSWORD") {
      logAuthEvent({ action: "auth.login.failed", userEmail: email, userId: dbUser.id });
      return false;
    }

    // Check account lockout
    if (dbUser.lockedUntil && dbUser.lockedUntil > new Date()) {
      logAuthEvent({ action: "auth.login.blocked", userEmail: email, userId: dbUser.id });
      return false;
    }

    // Lock if pre-existing failed attempts have hit the threshold (e.g. accumulated
    // via a prior password-reset flow or manual DB update). Do NOT increment here —
    // this callback fires only on a successful OAuth authentication.
    if (dbUser.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS),
        },
      });
      logAuthEvent({ action: "auth.login.blocked", userEmail: email, userId: dbUser.id });
      return false;
    }

    // Successful sign-in — reset failed attempt counter
    if (dbUser.failedLoginAttempts > 0 || dbUser.lockedUntil) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    // Backfill name from OAuth profile on first sign-in
    const name = profile?.name ?? user?.name;
    if (!dbUser.name && name) {
      await prisma.user.update({ where: { id: dbUser.id }, data: { name } });
    }

    logAuthEvent({ action: "auth.login.success", userEmail: email, userId: dbUser.id });
    return true;
  },

  async jwt({ token, user, profile }) {
    // user is only present on first sign-in
    if (user) {
      const email =
        user?.email ??
        (profile as Record<string, unknown>)?.preferred_username as string | undefined ??
        profile?.email;
      if (email) {
        const dbUser = await prisma.user.findFirst({
          where: { email: { equals: email.toLowerCase(), mode: "insensitive" } },
          select: { id: true, role: true },
        });
        if (dbUser) {
          token["id"] = dbUser.id;
          token["role"] = dbUser.role;
        }
      }
      // Bind the token to the User-Agent of the browser that signed in.
      // requestStore is populated by the auth handler wrappers below.
      const uaHash = requestStore.getStore()?.uaHash;
      if (uaHash) token["uaHash"] = uaHash;
    }
    return token;
  },

  async session({ session, token }) {
    if (session.user) {
      session.user.id = (token["id"] as string) ?? "";
      session.user.role = ((token["role"] as string) ?? "UPLOADER") as
        | "ADMIN"
        | "UPLOADER";
      session.user.uaHash = (token["uaHash"] as string | undefined);
    }
    return session;
  },
};

// ── Lazy singleton ────────────────────────────────────────────────────────────
// The NextAuth instance is built once on first use from environment config.
// SSO credentials change only via deployment (app settings + Key Vault), so a
// server restart is the natural way to pick up new values.

type AuthInstance = ReturnType<typeof NextAuth>;
let _promise: Promise<AuthInstance> | null = null;

async function buildInstance(): Promise<AuthInstance> {
  // All SSO config comes from the environment — there is no in-app/DB override.
  // Non-secret values (client IDs, tenant) are App Service application settings
  // (committed .env for local dev); secrets are loaded into process.env from
  // Azure Key Vault at startup (see src/lib/secrets.ts).
  const googleId     = process.env.GOOGLE_CLIENT_ID;
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
  const msId         = process.env.AZURE_AD_CLIENT_ID;
  const msSecret     = process.env.AZURE_AD_CLIENT_SECRET;
  const msTenant     = process.env.AZURE_AD_TENANT_ID ?? "common";

  const providers: NextAuthConfig["providers"] = [];

  // Local username/password sign-in. The heavy lifting — password + TOTP
  // verification, lockout, audit — happens in POST /api/account/login, which on
  // success mints a 60s HMAC login ticket. authorize() only validates that
  // ticket, so NextAuth never sees the password and we keep full control over
  // error messaging in the route. Always registered (no env gating).
  providers.push(
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: { email: {}, ticket: {} },
      async authorize(creds) {
        const email = (creds?.email as string | undefined)?.toLowerCase();
        const ticket = creds?.ticket as string | undefined;
        if (!email || !ticket) return null;

        const ticketEmail = verifyLoginTicket(ticket);
        if (!ticketEmail || ticketEmail.toLowerCase() !== email) return null;

        const dbUser = await prisma.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true, email: true, name: true, role: true, authMethod: true },
        });
        if (!dbUser || dbUser.authMethod !== "PASSWORD") return null;

        return { id: dbUser.id, email: dbUser.email, name: dbUser.name ?? undefined };
      },
    })
  );

  // prompt=select_account forces the IdP to show the account chooser on every
  // sign-in. Without it, signing out of the app leaves the IdP session intact,
  // so the next "Sign in" silently re-authenticates the previous account with
  // no way to pick a different one.
  if (googleId && googleSecret) {
    providers.push(
      Google({
        clientId: googleId,
        clientSecret: googleSecret,
        authorization: { params: { prompt: "select_account" } },
      })
    );
  }

  if (msId && msSecret) {
    providers.push(
      MicrosoftEntraID({
        clientId: msId,
        clientSecret: msSecret,
        issuer: `https://login.microsoftonline.com/${msTenant}/v2.0`,
        authorization: { params: { prompt: "select_account" } },
      })
    );
  }

  return NextAuth({
    providers,
    pages: { signIn: "/login", error: "/login" },
    callbacks,
    session: { strategy: "jwt", maxAge: 30 * 60 }, // 30 minutes
    logger: {
      // Surface the real cause behind generic Auth.js errors. InvalidCheck
      // ("pkceCodeVerifier value could not be parsed") hides whether the cookie
      // was MISSING or failed to DECRYPT inside error.cause — log it so prod
      // failures are diagnosable via App Insights (console is auto-collected).
      error(error: Error & { cause?: unknown }) {
        console.error(
          "[auth][error]",
          error?.name,
          "|",
          error?.message,
          "| cause:",
          error?.cause ?? "(none)"
        );
      },
    },
    events: {
      async signOut(message) {
        const token = "token" in message ? message.token : null;
        logAuthEvent({
          action: "auth.logout",
          userId: token?.["id"] as string | undefined,
          userEmail: token?.email ?? null,
        });
      },
    },
  });
}

function getInstance(): Promise<AuthInstance> {
  if (!_promise) _promise = buildInstance();
  return _promise;
}

// ── Proxy exports ─────────────────────────────────────────────────────────────

export const handlers = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GET: async (req: any) => {
    requestStore.enterWith({ uaHash: hashUa(req?.headers?.get?.("user-agent")) });
    return (await getInstance()).handlers.GET(req);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  POST: async (req: any) => {
    requestStore.enterWith({ uaHash: hashUa(req?.headers?.get?.("user-agent")) });
    return (await getInstance()).handlers.POST(req);
  },
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
