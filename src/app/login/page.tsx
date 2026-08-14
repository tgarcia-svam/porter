"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error  = searchParams.get("error");
  const reason = searchParams.get("reason");
  const raw = searchParams.get("callbackUrl") || "/";
  // Reject absolute URLs and protocol-relative URLs to prevent open redirect.
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  const oauthError =
    error === "AccessDenied"
      ? "Your account is not authorized. Contact an administrator."
      : error
      ? "Sign-in failed. Please try again."
      : null;

  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Second-factor state (from step 1)
  const [pendingTicket, setPendingTicket] = useState("");
  const [methods, setMethods] = useState<{ passkey: boolean; totp: boolean }>({ passkey: false, totp: false });

  function messageFor(code: string | undefined, retryAfterSec?: number): string {
    switch (code) {
      case "bad_credentials": return "Incorrect email or password.";
      case "mfa_invalid":     return "That didn't verify. Try again.";
      case "expired":         return "Your sign-in timed out. Please start again.";
      case "locked_temp": {
        const mins = Math.max(1, Math.ceil((retryAfterSec ?? 900) / 60));
        return `Too many attempts. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
      }
      case "invite_pending":     return "You haven't set a password yet. Check your email for an invitation link.";
      case "locked_reset":       return "Account locked after too many failed attempts. Reset your password to unlock it.";
      case "mfa_setup_required": return "Finish setting up your account from the email link, or reset your password.";
      default:                   return "Sign-in failed. Please try again.";
    }
  }

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiFetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.code === "mfa_required") {
        setPendingTicket(data.pendingTicket);
        setMethods(data.methods ?? { passkey: false, totp: true });
        setStep("mfa");
        return;
      }
      if (res.ok && data?.ok && data?.ticket) { await finalize(data.ticket); return; }
      setFormError(messageFor(data?.code, data?.retryAfterSec));
    } catch {
      setFormError("Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiFetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), pendingTicket, totp: totp.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && data?.ticket) { await finalize(data.ticket); return; }
      if (data?.code === "expired" || data?.code === "locked_reset" || data?.code === "locked_temp") {
        setStep("credentials");
      }
      setFormError(messageFor(data?.code, data?.retryAfterSec));
    } catch {
      setFormError("Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPasskey() {
    setFormError(null);
    setBusy(true);
    try {
      const optRes = await apiFetch("/api/account/passkey/auth-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), pendingTicket }),
      });
      const options = await optRes.json();
      if (!optRes.ok) { setStep("credentials"); setFormError(messageFor("expired")); return; }

      const { startAuthentication } = await import("@simplewebauthn/browser");
      const assertion = await startAuthentication(options);

      const res = await apiFetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), pendingTicket, passkey: assertion }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && data?.ticket) { await finalize(data.ticket); return; }
      if (data?.code === "expired") setStep("credentials");
      setFormError(messageFor(data?.code, data?.retryAfterSec));
    } catch (err) {
      setFormError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Passkey prompt was cancelled."
          : "Couldn't use a passkey. Try a code instead, or start again."
      );
    } finally {
      setBusy(false);
    }
  }

  async function finalize(ticket: string) {
    const res = await signIn("credentials", {
      redirect: false,
      email: email.trim().toLowerCase(),
      ticket,
      callbackUrl,
    });
    if (res?.ok) {
      router.push(callbackUrl);
      router.refresh();
    } else {
      setFormError("Sign-in failed. Please try again.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-600 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Porter</h1>
            <p className="mt-1 text-sm text-gray-500">Sign in to share and validate your data files</p>
          </div>

          {reason === "idle" && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              You were signed out after 30 minutes of inactivity.
            </div>
          )}

          {reason === "session_expired" && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              Your session has expired. Please sign in again.
            </div>
          )}

          {(oauthError || formError) && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              {formError ?? oauthError}
            </div>
          )}

          {step === "credentials" ? (
            <form onSubmit={submitCredentials} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email" autoComplete="username" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                <input
                  type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="••••••••••••••••"
                />
              </div>
              <button
                type="submit" disabled={busy}
                className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>
              <div className="text-right">
                <Link href="/account/forgot" className="text-xs text-brand-600 hover:underline">Forgot password?</Link>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              {methods.passkey && (
                <button
                  onClick={signInWithPasskey}
                  disabled={busy}
                  className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  🔑 {busy ? "Waiting for passkey…" : "Use your passkey"}
                </button>
              )}

              {methods.passkey && methods.totp && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-2 text-xs text-gray-400">or enter a code</span>
                  </div>
                </div>
              )}

              {methods.totp && (
                <form onSubmit={submitTotp} className="space-y-3">
                  <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator app.</p>
                  <input
                    inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus
                    value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="000000"
                  />
                  <button
                    type="submit" disabled={busy}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {busy ? "Verifying…" : "Verify & sign in"}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => { setStep("credentials"); setTotp(""); setFormError(null); }}
                className="w-full text-xs text-gray-500 hover:underline"
              >
                Back
              </button>
            </div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-2 text-xs text-gray-400">or continue with</span>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => signIn("google", { callbackUrl })}
              className="w-full flex items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              <GoogleIcon />
              Continue with Google
            </button>
            <button
              onClick={() => signIn("microsoft-entra-id", { callbackUrl })}
              className="w-full flex items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              <MicrosoftIcon />
              Continue with Microsoft
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
