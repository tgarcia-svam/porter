import { type APIRequestContext } from "@playwright/test";

/** Read the csrf-token cookie from the current storage state. */
export async function csrfToken(request: APIRequestContext): Promise<string> {
  const state = await request.storageState();
  return state.cookies.find((c) => c.name === "csrf-token")?.value ?? "";
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
