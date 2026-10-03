import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/** Refresh sessions; pages and routes still verify identity independently. */
export async function proxy(request: NextRequest) {
  const authPage = ["/login", "/signup"].includes(request.nextUrl.pathname);
  const authNonce = authPage && !request.cookies.has("cloud_auth_csrf") ? randomBytes(24).toString("base64url") : null;
  if (authNonce) request.cookies.set("cloud_auth_csrf", authNonce);
  const linkSubmission = request.method === "POST" && request.nextUrl.pathname === "/link/start";
  const destination = request.nextUrl.clone();
  if (linkSubmission) destination.pathname = "/link/continue";
  function next() {
    return linkSubmission
      ? NextResponse.rewrite(destination, { request: { headers: request.headers } })
      : NextResponse.next({ request });
  }
  let response = next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookieOptions: { name: "contour-cloud-auth", httpOnly: true, sameSite: "lax", secure: (process.env.APP_URL ?? "").startsWith("https://") }, cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = next();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    } },
  );
  await supabase.auth.getClaims();
  if (authNonce) response.cookies.set("cloud_auth_csrf", authNonce, {
    httpOnly: true, sameSite: "lax", secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/", maxAge: 3600,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api/mcp|api/oauth|\\.well-known|_next/static|_next/image|favicon.ico).*)"],
};
