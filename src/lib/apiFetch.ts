import { signOut } from "next-auth/react";

const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";

function getCsrfToken(): string {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CSRF_COOKIE}=`));
  return match ? match.split("=")[1] : "";
}

// When any API call returns 401 or 403 outside the login page, the session has
// expired, the session binding failed, or the CSRF cookie was cleared (e.g. by
// a screen-lock policy). Redirect to login rather than showing a silent error.
function handleAuthError(res: Response): Response {
  if ((res.status === 401 || res.status === 403) && window.location.pathname !== "/login") {
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
