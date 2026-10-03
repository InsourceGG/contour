import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";
export const AUTH_CSRF_COOKIE = "cloud_auth_csrf";
export function newAuthNonce() { return randomBytes(24).toString("base64url"); }
export function authCsrf(nonce: string) { return createHmac("sha256", env.csrfSecret).update(`cloud-auth:${nonce}`).digest("base64url"); }
export async function authCsrfForPage() {
  const nonce = (await cookies()).get(AUTH_CSRF_COOKIE)?.value;
  return nonce ? authCsrf(nonce) : "";
}
export async function checkAuthCsrf(request: Request, form: FormData) {
  if (request.headers.get("origin") !== new URL(env.appUrl).origin) return false;
  const nonce = (await cookies()).get(AUTH_CSRF_COOKIE)?.value;
  if (!nonce) return false;
  const a = Buffer.from(String(form.get("csrf") ?? "")), b = Buffer.from(authCsrf(nonce));
  return a.length === b.length && timingSafeEqual(a,b);
}
