import "server-only";
import { ContourError } from "@contour/sdk/core";
import { contour } from "./contour";
import { resolveHostUser } from "./context";
import { env } from "./env";
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(value)) return "/projects";
  return value;
}
export async function authenticatedForm(request: Request) {
  const user = await resolveHostUser();
  const form = await request.formData();
  const headers = new Headers(request.headers);
  headers.set("x-contour-csrf", String(form.get("csrf") ?? ""));
  contour.assertCsrf(new Request(request.url, { method: "POST", headers }), user);
  return { user, form };
}
export function go(path: string) { return Response.redirect(new URL(path, env.appUrl), 303); }
export function formFailure(error: unknown, path: string) {
  if (error instanceof ContourError && error.code === "UNAUTHENTICATED") return go(`/login?next=${encodeURIComponent(path)}`);
  return go(`${path}?error=${error instanceof ContourError && error.code === "FORBIDDEN" ? "permission" : "unavailable"}`);
}
