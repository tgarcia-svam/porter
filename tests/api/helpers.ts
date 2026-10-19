import { type APIRequestContext } from "@playwright/test";

/** The csrf-token cookie is HttpOnly; fetch the signed, session-bound token from /api/csrf. */
export async function csrfToken(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/csrf");
  return ((await res.json()) as { token?: string }).token ?? "";
}

/** POST with CSRF header included. */
export async function apiPost(
  request: APIRequestContext,
  url: string,
  data: unknown,
) {
  const csrf = await csrfToken(request);
  return request.post(url, {
    data,
    headers: { "x-csrf-token": csrf },
  });
}

/** PUT with CSRF header included. */
export async function apiPut(
  request: APIRequestContext,
  url: string,
  data: unknown,
) {
  const csrf = await csrfToken(request);
  return request.put(url, {
    data,
    headers: { "x-csrf-token": csrf },
  });
}

/** DELETE with CSRF header included. */
export async function apiDelete(request: APIRequestContext, url: string) {
  const csrf = await csrfToken(request);
  return request.delete(url, {
    headers: { "x-csrf-token": csrf },
  });
}
