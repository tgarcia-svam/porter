"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";

const IDLE_MS = 30 * 60 * 1000;
const WARN_BEFORE_MS = 2 * 60 * 1000;
// Poll every 10 s — avoids browser setTimeout throttling in background tabs.
const CHECK_MS = 10_000;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

export default function IdleTimeout() {
  const [msLeft, setMsLeft] = useState<number | null>(null);
  const lastActivity = useRef<number>(Date.now());

  useEffect(() => {
    function onActivity() {
      lastActivity.current = Date.now();
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }

    const interval = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      const remaining = IDLE_MS - idle;

      if (remaining <= 0) {
        signOut({ callbackUrl: "/login?reason=idle" });
      } else if (remaining <= WARN_BEFORE_MS) {
        setMsLeft(remaining);
      } else {
        setMsLeft(null);
      }
    }, CHECK_MS);

    return () => {
      clearInterval(interval);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
    };
  }, []);

  if (msLeft === null) return null;

  const mins = Math.floor(msLeft / 60_000);
  const secs = Math.ceil((msLeft % 60_000) / 1000);
  const label =
    mins > 0
      ? `${mins} minute${mins !== 1 ? "s" : ""}`
      : `${secs} second${secs !== 1 ? "s" : ""}`;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 shadow-lg">
      <p className="text-sm font-medium text-amber-800">
        Your session will expire in {label} due to inactivity.
      </p>
      <p className="mt-1 text-xs text-amber-600">
        Move your mouse or press any key to stay signed in.
      </p>
    </div>
  );
}
