"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";

const IDLE_MS = 30 * 60 * 1000;       // 30 minutes
const WARN_MS = IDLE_MS - 2 * 60 * 1000; // warn 2 minutes before

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

export default function IdleTimeout() {
  const [warning, setWarning] = useState(false);
  const idleTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function reset() {
      setWarning(false);

      if (idleTimer.current)  clearTimeout(idleTimer.current);
      if (warnTimer.current)  clearTimeout(warnTimer.current);

      warnTimer.current = setTimeout(() => setWarning(true), WARN_MS);
      idleTimer.current = setTimeout(() => {
        signOut({ callbackUrl: "/login?reason=idle" });
      }, IDLE_MS);
    }

    reset(); // start timers on mount

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true });
    }

    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (warnTimer.current) clearTimeout(warnTimer.current);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, reset);
      }
    };
  }, []);

  if (!warning) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 shadow-lg">
      <p className="text-sm font-medium text-amber-800">
        Your session will expire in 2 minutes due to inactivity.
      </p>
      <p className="mt-1 text-xs text-amber-600">
        Move your mouse or press any key to stay signed in.
      </p>
    </div>
  );
}
