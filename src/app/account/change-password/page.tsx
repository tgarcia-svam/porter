"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { checkPassword, MIN_PASSWORD_LENGTH, MIN_CHARACTER_CLASSES } from "@/lib/password-policy";

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-green-700" : "text-gray-500"}`}>
      <span aria-hidden>{ok ? "✓" : "○"}</span>
      <span>{children}</span>
    </li>
  );
}

function ChangePasswordForm() {
  const router = useRouter();
  const expired = useSearchParams().get("expired") === "1";

  const [current, setCurrent]     = useState("");
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [busy, setBusy]           = useState(false);
  const [errors, setErrors]       = useState<string[]>([]);
  const [success, setSuccess]     = useState(false);

  const checks = checkPassword(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    if (password !== confirm) {
      setErrors(["Passwords do not match."]);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/account/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: password }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => router.push("/upload"), 1500);
      } else {
        const data = await res.json();
        setErrors(Array.isArray(data.error) ? data.error : [data.error ?? "An error occurred."]);
      }
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 p-6 text-center text-green-800">
        Password changed successfully. Redirecting…
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {expired && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-800">
          Your password has expired and must be changed before you can continue.
        </div>
      )}

      {errors.length > 0 && (
        <ul className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 space-y-1 list-disc list-inside">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div>
        <label htmlFor="current" className="block text-sm font-medium text-gray-700 mb-1">
          Current password
        </label>
        <input
          id="current"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          New password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {password && (
          <ul className="mt-2 space-y-1 text-sm">
            <Rule ok={checks.length}>At least {MIN_PASSWORD_LENGTH} characters</Rule>
            <Rule ok={checks.classes}>At least {MIN_CHARACTER_CLASSES} of 4 character classes (upper, lower, digit, special)</Rule>
            <Rule ok={checks.notCommon}>Not a common password</Rule>
            <Rule ok={checks.notUsername}>Does not contain your username</Rule>
          </ul>
        )}
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}

export default function ChangePasswordPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Change password</h1>
        <Suspense>
          <ChangePasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
