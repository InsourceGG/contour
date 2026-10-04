/**
 * Browser-side helpers for the host API routes. Never import server modules here.
 * Every mutation carries the session-bound CSRF token in `x-contour-csrf`.
 */

export const CSRF_HEADER = "x-contour-csrf";

export type ApiError = {
  code: string;
  message: string;
  currentRevision?: number;
  issues?: { code: string; path: string; message: string }[];
  [k: string]: unknown;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

async function request<T>(method: string, path: string, body: unknown, csrf?: string): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (csrf) headers[CSRF_HEADER] = csrf;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: "OFFLINE", message: "Couldn't reach the server. Check your connection and try again." },
    };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const raw = (json as { error?: Partial<ApiError> } | null)?.error;
    return {
      ok: false,
      status: res.status,
      error: {
        ...(raw ?? {}),
        code: typeof raw?.code === "string" ? raw.code : res.status === 401 ? "UNAUTHENTICATED" : "INTERNAL",
        message: typeof raw?.message === "string" ? raw.message : `Request failed (${res.status}).`,
      },
    };
  }
  return { ok: true, data: json as T };
}

export function apiPost<T = unknown>(path: string, body: unknown, csrf: string) {
  return request<T>("POST", path, body ?? {}, csrf);
}

export function apiPut<T = unknown>(path: string, body: unknown, csrf: string) {
  return request<T>("PUT", path, body, csrf);
}

export function apiGet<T = unknown>(path: string) {
  return request<T>("GET", path, undefined);
}

export function newKey(): string {
  return crypto.randomUUID();
}
