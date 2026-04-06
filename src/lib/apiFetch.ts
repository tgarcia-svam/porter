const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";

function getCsrfToken(): string {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CSRF_COOKIE}=`));
  return match ? match.split("=")[1] : "";
}

/**
 * Drop-in replacement for fetch() that automatically injects the CSRF token
 * header on state-changing requests (POST, PUT, DELETE, PATCH).
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const mutating = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  if (!mutating) return fetch(input, init);

  const headers = new Headers(init?.headers);
  headers.set(CSRF_HEADER, getCsrfToken());

  return fetch(input, { ...init, headers });
}
