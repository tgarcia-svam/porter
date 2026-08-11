import { signOut } from "next-auth/react";

const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";

function getCsrfToken(): string {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CSRF_COOKIE}=`));
  return match ? match.split("=")[1] : "";
}

// 401 means the session has expired or the session binding check failed.
// 403s are intentionally excluded: domain 403s ("cannot delete your own account",
// "cannot remove last admin") must show their error message, not trigger a sign-out.
function handleAuthError(res: Response): Response {
  if (res.status === 401 && window.location.pathname !== "/login") {
    void signOut({ callbackUrl: "/login?reason=session_expired" });
  }
  return res;
}

/**
 * Drop-in replacement for fetch() that automatically injects the CSRF token
 * header on state-changing requests (POST, PUT, DELETE, PATCH) and redirects
 * to the login page on 401 (expired session / UA mismatch).
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const mutating = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  if (!mutating) return fetch(input, init).then(handleAuthError);

  const headers = new Headers(init?.headers);
  headers.set(CSRF_HEADER, getCsrfToken());

  return fetch(input, { ...init, headers }).then(handleAuthError);
}
