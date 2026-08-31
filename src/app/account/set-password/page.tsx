"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { checkPassword, MIN_PASSWORD_LENGTH, MIN_CHARACTER_CLASSES, type PolicyOverrides } from "@/lib/password-policy";

type MfaMethod = "choose" | "passkey" | "totp";

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-green-700" : "text-gray-500"}`}>
      <span aria-hidden>{ok ? "✓" : "○"}</span>
      <span>{children}</span>
    </li>
  );
}

function SetPasswordContent() {
  const token = useSearchParams().get("token") ?? "";

  const [phase, setPhase] = useState<"checking" | "password" | "mfa" | "done" | "expired">(
    token ? "checking" : "password"
  );

  // Validate the token before rendering the form so expired links show an error
  // immediately instead of only after the user fills out and submits the form.
  useEffect(() => {
    if (!token || phase !== "checking") return;
    fetch(`/api/account/reset?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => setPhase(d.valid ? "password" : "expired"))
      .catch(() => setPhase("expired"));
  }, [token, phase]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const [enrollToken, setEnrollToken] = useState("");
  const [method, setMethod] = useState<MfaMethod>("choose");
  const [mfaError, setMfaError] = useState<string | null>(null);

  // TOTP enrollment
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");

  const [policy, setPolicy] = useState<PolicyOverrides>({
    minLength: MIN_PASSWORD_LENGTH, minClasses: MIN_CHARACTER_CLASSES,
  });
  useEffect(() => {
    fetch("/api/account/password-policy")
      .then((r) => r.json())
      .then((d) => setPolicy(d))
      .catch(() => {});
  }, []);

  const checks = checkPassword(password, undefined, policy);
  const matches = password.length > 0 && password === confirm;
  const canSubmit = checks.length && checks.classes && checks.notCommon && matches && !busy;

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setBusy(true);
    try {
      const res = await apiFetch("/api/account/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(Array.isArray(data?.error) ? data.error : [data?.error ?? "Could not set password."]);
        return;
      }
      if (data.next === "mfa" && data.enrollToken) {
        setEnrollToken(data.enrollToken);
        setPhase("mfa");
      } else {
        setPhase("done");
      }
    } catch {
      setErrors(["Something went wrong. Please try again."]);
    } finally {
      setBusy(false);
    }
  }

  // ── Passkey enrollment ──────────────────────────────────────────────────────
  async function enrollPasskey() {
    setMfaError(null);
    setBusy(true);
    try {
      const optRes = await apiFetch("/api/account/mfa/passkey/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollToken }),
      });
      const options = await optRes.json();
      if (!optRes.ok) {
        setMfaError(options?.error ?? "Could not start passkey setup.");
        return;
      }
      const { startRegistration } = await import("@simplewebauthn/browser");
      const response = await startRegistration(options);
      const verifyRes = await apiFetch("/api/account/mfa/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollToken, response }),
      });
      const data = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) {
        setMfaError(data?.error ?? "Could not register that passkey.");
        return;
      }
      setPhase("done");
    } catch (err) {
      // User cancelled the browser prompt, or no authenticator available.
      setMfaError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Passkey setup was cancelled."
          : "Could not set up a passkey on this device. Try an authenticator app instead."
      );
    } finally {
      setBusy(false);
    }
  }

  // ── TOTP enrollment: fetch secret + render QR when the method is picked ──────
  useEffect(() => {
    if (method !== "totp" || !enrollToken || qr) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/account/mfa/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enrollToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setMfaError(data?.error ?? "Could not start authenticator setup.");
          return;
        }
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 200 });
        if (!cancelled) {
          setSecret(data.secret);
          setQr(dataUrl);
        }
      } catch {
        if (!cancelled) setMfaError("Could not start authenticator setup.");
      }
    })();
    return () => { cancelled = true; };
  }, [method, enrollToken, qr]);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setMfaError(null);
    setBusy(true);
    try {
      const res = await apiFetch("/api/account/mfa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollToken, code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMfaError(data?.error ?? "That code didn't match. Try again.");
        return;
      }
      setPhase("done");
    } catch {
      setMfaError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
          {!token ? (
            <div className="text-center space-y-3">
              <h1 className="text-xl font-bold text-gray-900">Invalid link</h1>
              <p className="text-sm text-gray-500">This link is missing its token. Request a new one.</p>
              <Link href="/account/forgot" className="text-sm text-brand-600 hover:underline">
                Request a reset link
              </Link>
            </div>
          ) : phase === "checking" ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
            </div>
          ) : phase === "expired" ? (
            <div className="text-center space-y-3">
              <h1 className="text-xl font-bold text-gray-900">Link expired</h1>
              <p className="text-sm text-gray-500">
                This link has already been used or has expired. Request a new one.
              </p>
              <Link href="/account/forgot" className="text-sm text-brand-600 hover:underline">
                Request a new link
              </Link>
            </div>
          ) : phase === "password" ? (
            <>
              <div className="text-center">
                <h1 className="text-2xl font-bold text-gray-900">Set your password</h1>
                <p className="mt-1 text-sm text-gray-500">Choose a strong password to secure your account.</p>
              </div>

              {errors.length > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                  <ul className="list-disc list-inside space-y-1">
                    {errors.map((er, i) => <li key={i}>{er}</li>)}
                  </ul>
                </div>
              )}

              <form onSubmit={submitPassword} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">New password</label>
                  <input
                    type="password" autoComplete="new-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Confirm password</label>
                  <input
                    type="password" autoComplete="new-password" required
                    value={confirm} onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <ul className="text-xs space-y-1">
                  <Rule ok={checks.length}>At least {policy.minLength ?? MIN_PASSWORD_LENGTH} characters</Rule>
                  <Rule ok={checks.classes}>
                    At least {policy.minClasses ?? MIN_CHARACTER_CLASSES} of: uppercase, lowercase, number, special character
                  </Rule>
                  <Rule ok={checks.notCommon}>Not a common or easily-guessed password</Rule>
                  <Rule ok={matches}>Passwords match</Rule>
                </ul>
                <button
                  type="submit" disabled={!canSubmit}
                  className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {busy ? "Saving…" : "Set password"}
                </button>
              </form>
            </>
          ) : phase === "mfa" ? (
            <>
              <div className="text-center">
                <h1 className="text-2xl font-bold text-gray-900">Add a second factor</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Two-factor authentication is required. Pick a method to finish.
                </p>
              </div>

              {mfaError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{mfaError}</div>
              )}

              {method === "choose" && (
                <div className="space-y-3">
                  <button
                    onClick={enrollPasskey}
                    disabled={busy}
                    className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors text-left"
                  >
                    <span className="block">🔑 Use a passkey <span className="text-brand-200">(recommended)</span></span>
                    <span className="block text-xs font-normal text-brand-100 mt-0.5">
                      Face ID, fingerprint, Windows Hello, or a security key — one tap, no codes.
                    </span>
                  </button>
                  <button
                    onClick={() => { setMfaError(null); setMethod("totp"); }}
                    disabled={busy}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors text-left"
                  >
                    <span className="block">📱 Use an authenticator app</span>
                    <span className="block text-xs font-normal text-gray-500 mt-0.5">
                      Scan a QR code with Google/Microsoft Authenticator or Authy.
                    </span>
                  </button>
                </div>
              )}

              {method === "totp" && (
                <>
                  <div className="flex flex-col items-center gap-3">
                    {qr ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qr} alt="Authenticator QR code" className="rounded-lg border border-gray-200" />
                    ) : (
                      <div className="h-[200px] w-[200px] animate-pulse rounded-lg bg-gray-100" />
                    )}
                    {secret && (
                      <p className="text-xs text-gray-500 text-center">
                        Can&apos;t scan? Enter this key manually:<br />
                        <code className="font-mono text-gray-700 break-all">{secret}</code>
                      </p>
                    )}
                  </div>
                  <form onSubmit={submitCode} className="space-y-3">
                    <input
                      inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required
                      value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="000000"
                    />
                    <button
                      type="submit" disabled={busy || !qr}
                      className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                    >
                      {busy ? "Verifying…" : "Verify & finish"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMethod("choose"); setMfaError(null); setQr(null); setSecret(""); setCode(""); }}
                      className="w-full text-xs text-gray-500 hover:underline"
                    >
                      Choose a different method
                    </button>
                  </form>
                </>
              )}
            </>
          ) : (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 text-green-700 text-2xl">✓</div>
              <h1 className="text-2xl font-bold text-gray-900">You&apos;re all set</h1>
              <p className="text-sm text-gray-500">
                Your password and second factor are configured. You can sign in now.
              </p>
              <Link
                href="/login"
                className="inline-block rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
              >
                Go to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense>
      <SetPasswordContent />
    </Suspense>
  );
}
