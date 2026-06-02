import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
// Authentication runs before any user/org context exists, so it must bypass RLS.
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
import { logAuthEvent } from "@/lib/auth-audit";
import { requestStore, hashUa } from "@/lib/session-binding";

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

    // Check account lockout
    if (dbUser.lockedUntil && dbUser.lockedUntil > new Date()) {
      logAuthEvent({ action: "auth.login.blocked", userEmail: email, userId: dbUser.id });
      return false;
    }

    // Increment failed attempts and lock if threshold reached
    // (This path is hit when the account exists but is in a bad state — e.g.
    // a race between lockout expiry and a new attempt, or manual testing.)
    // Normal happy-path resets the counter below.
    const newCount = dbUser.failedLoginAttempts + 1;
    if (newCount >= MAX_FAILED_ATTEMPTS) {
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
      console.log("[auth] jwt — email resolved:", !!email);
      if (email) {
        const dbUser = await prisma.user.findFirst({
          where: { email: { equals: email.toLowerCase(), mode: "insensitive" } },
          select: { id: true, role: true },
        });
        console.log("[auth] jwt DB lookup →", dbUser ? `id=${dbUser.id}` : "NOT FOUND");
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
// The NextAuth instance is built asynchronously on first use, reading SSO
// credentials from AppSetting (DB) first, falling back to env vars.
// Call invalidateAuth() after saving SSO settings so the next request
// rebuilds the instance with the new values — no server restart needed.

type AuthInstance = ReturnType<typeof NextAuth>;
let _promise: Promise<AuthInstance> | null = null;

async function buildInstance(): Promise<AuthInstance> {
  // Non-secret config (client IDs, tenant) may come from DB or env.
  // Secrets (client secrets) come exclusively from process.env, which is
  // populated from Azure Key Vault at startup — never from the DB.
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: ["GOOGLE_CLIENT_ID", "AZURE_AD_CLIENT_ID", "AZURE_AD_TENANT_ID"],
      },
    },
  });
  const db = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  const googleId     = db.GOOGLE_CLIENT_ID  ?? process.env.GOOGLE_CLIENT_ID;
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
  const msId         = db.AZURE_AD_CLIENT_ID ?? process.env.AZURE_AD_CLIENT_ID;
  const msSecret     = process.env.AZURE_AD_CLIENT_SECRET;
  const msTenant     = db.AZURE_AD_TENANT_ID ?? process.env.AZURE_AD_TENANT_ID ?? "common";

  const providers: NextAuthConfig["providers"] = [];

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

/** Invalidate the cached NextAuth instance. Call after saving SSO settings. */
export function invalidateAuth(): void {
  _promise = null;
}

// ── Proxy exports ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reqPath(req: any): string {
  try {
    return req?.nextUrl?.pathname ?? new URL(req.url).pathname;
  } catch {
    return "";
  }
}

/** Comma-joined cookie NAMES from an incoming Cookie header (values omitted). */
function inCookieNames(header: string | null | undefined): string {
  if (!header) return "(none)";
  return (
    header
      .split(";")
      .map((c) => c.split("=")[0].trim())
      .filter(Boolean)
      .join(", ") || "(none)"
  );
}

export const handlers = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GET: async (req: any) => {
    requestStore.enterWith({ uaHash: hashUa(req?.headers?.get?.("user-agent")) });
    const res = await (await getInstance()).handlers.GET(req);
    // DIAG: on the OAuth callback, log the host the request arrived on plus the
    // cookies the browser actually sent. Compare the host against the sign-in
    // host below — if they differ, the host-only pkce cookie won't be sent.
    const path = reqPath(req);
    if (path.includes("/callback/")) {
      console.log(
        "[auth][diag] callback IN —",
        diagHost(req),
        "| cookies:",
        inCookieNames(req?.headers?.get?.("cookie"))
      );
    }
    return res;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  POST: async (req: any) => {
    requestStore.enterWith({ uaHash: hashUa(req?.headers?.get?.("user-agent")) });
    const res = await (await getInstance()).handlers.POST(req);
    // DIAG: on sign-in, log the host plus the Set-Cookie names/flags Auth.js
    // emitted (e.g. __Secure- prefix, SameSite, Secure, Domain).
    const path = reqPath(req);
    if (path.includes("/signin/")) {
      const sc =
        typeof res?.headers?.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      console.log(
        "[auth][diag] signin OUT —",
        diagHost(req),
        "| set-cookie:",
        sc.length
          ? sc.map((c: string) => c.split(";")[0].split("=")[0] + " [" + c.split(";").slice(1).map((a: string) => a.trim()).join(" ") + "]").join(" | ")
          : "(none)"
      );
    }
    return res;
  },
};

/** host / x-forwarded-host / proto, for spotting host mismatches between legs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function diagHost(req: any): string {
  const h = (k: string) => req?.headers?.get?.(k) ?? "-";
  return `host=${h("host")} xfh=${h("x-forwarded-host")} xfp=${h("x-forwarded-proto")} url=${reqPath(req)}`;
}

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
