"use client";

import { useState, useEffect } from "react";
import type { Session } from "next-auth";

type Props = { session: Session };

export default function LoginNoticeBanner({ session }: Props) {
  const { prevLoginAt, prevLoginIp, prevFailedAttempts } = session.user;
  const [dismissed, setDismissed] = useState(true); // start hidden; show after mount check

  useEffect(() => {
    if (!prevLoginAt) return;
    // One dismissal per session: keyed by prevLoginAt so it reappears on the next login
    const key = `loginBannerDismissed_${prevLoginAt}`;
    try {
      if (!sessionStorage.getItem(key)) setDismissed(false);
    } catch {
      // sessionStorage unavailable (private browsing, sandbox) — don't show
    }
  }, [prevLoginAt]);

  if (dismissed || !prevLoginAt) return null;

  const date = new Date(prevLoginAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function dismiss() {
    const key = `loginBannerDismissed_${prevLoginAt}`;
    try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ }
    setDismissed(true);
  }

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between text-sm text-blue-800">
      <span>
        Previous login: <strong>{date}</strong>
        {prevLoginIp ? <> from <strong>{prevLoginIp}</strong></> : null}
        {" · "}
        {(prevFailedAttempts ?? 0) === 0
          ? "No failed attempts since then."
          : <span className="text-amber-700 font-medium">{prevFailedAttempts} failed attempt{prevFailedAttempts === 1 ? "" : "s"} since then.</span>
        }
      </span>
      <button
        onClick={dismiss}
        aria-label="Dismiss login notice"
        className="ml-4 text-blue-600 hover:text-blue-800 font-medium"
      >
        ×
      </button>
    </div>
  );
}
