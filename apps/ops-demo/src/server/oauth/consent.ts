import "server-only";
import { ContourError, type Scope } from "@/sdk/types";
import { APP_ID, resolveHostUser, type HostUser } from "../context";
import { csrfTokenFor } from "../csrf";
import { env } from "../env";
import { authorizePathFor, buildClientRedirect, validateAuthorizeRequest, type RawParams } from "./authorize";
import { GRANTABLE_SURFACES, NO_STORE_HEADERS } from "./config";
import { issueAuthorizationCode } from "./codes";
import { safeEqual } from "./crypto";
import { upsertGrant } from "./grants";
import { isAgentAccessEnabled } from "./tokens";

const MAX_FORM_BYTES = 8 * 1024;

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function errorPage(status: number, message: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Authorization error · Contour</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.25rem">Authorization could not continue</h1><p>${htmlEscape(message)}</p>
<p><a href="/">Return to Contour</a></p></body></html>`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'", ...NO_STORE_HEADERS },
  });
}

function redirect303(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...NO_STORE_HEADERS } });
}

/** Same-origin + session-bound token check (mirrors `assertCsrf`, token from the form body). */
function checkFormCsrf(request: Request, user: HostUser, provided: string | null): boolean {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(env.appUrl).origin;
  const requestOrigin = new URL(request.url).origin;
  if (!origin || (origin !== expectedOrigin && origin !== requestOrigin)) return false;
  return !!provided && safeEqual(provided, csrfTokenFor(user));
}

/** POST /oauth/authorize/decision: the user's Approve / Deny on the consent screen. */
export async function handleConsentDecision(request: Request): Promise<Response> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) return errorPage(415, "Unsupported form submission.");
  const text = await request.text();
  if (text.length > MAX_FORM_BYTES) return errorPage(413, "Form submission too large.");
  const form = new URLSearchParams(text);
  const raw: RawParams = {};
  for (const key of new Set(form.keys())) {
    const all = form.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }

  let user: HostUser;
  try {
    user = await resolveHostUser();
  } catch (e) {
    if (e instanceof ContourError && e.code === "UNAUTHENTICATED") {
      return redirect303(`/login?next=${encodeURIComponent(authorizePathFor(raw))}`);
    }
    if (e instanceof ContourError && e.code === "FORBIDDEN") return errorPage(403, "Your account has no active membership for this app.");
    return errorPage(500, "Could not verify your session.");
  }

  if (!checkFormCsrf(request, user, form.get("csrf"))) {
    return errorPage(403, "This approval request did not come from the Contour consent screen. Please start again from your agent.");
  }

  // Re-validate every parameter server-side; the form is untrusted input.
  const v = await validateAuthorizeRequest(raw);
  if (v.kind === "fatal") return errorPage(400, v.message);
  if (v.kind === "redirect_error") {
    return redirect303(buildClientRedirect(v.redirectUri, { error: v.error, error_description: v.description, state: v.state }));
  }
  const req = v.request;
  const decision = form.get("decision");
  if (decision !== "approve") {
    return redirect303(
      buildClientRedirect(req.redirectUri, { error: "access_denied", error_description: "The user denied the request", state: req.state }),
    );
  }

  if (!(await isAgentAccessEnabled(user.tenantId, APP_ID))) {
    return redirect303(
      buildClientRedirect(req.redirectUri, {
        error: "access_denied",
        error_description: "The company has disabled agent access for this app",
        state: req.state,
      }),
    );
  }

  // Optional narrowing by the user: unchecked boxes drop scopes (never adds).
  // view:read, when requested, is kept because describe/get need it.
  const chosen = form.getAll("grant_scope");
  let scopes: Scope[] = req.scopes;
  if (form.get("scope_choice") === "1") {
    scopes = req.scopes.filter((s) => s === "view:read" || chosen.includes(s));
  }
  if (scopes.length === 0) {
    return redirect303(
      buildClientRedirect(req.redirectUri, { error: "invalid_scope", error_description: "No scopes were approved", state: req.state }),
    );
  }

  const surfaces = [...GRANTABLE_SURFACES];
  const grant = await upsertGrant({
    subjectId: user.subjectId,
    tenantId: user.tenantId, // from server-side membership, never from the request
    appId: APP_ID,
    clientId: req.clientId,
    scopes,
    surfaces,
  });
  const code = await issueAuthorizationCode({
    clientId: req.clientId,
    subjectId: user.subjectId,
    tenantId: user.tenantId,
    appId: APP_ID,
    scopes,
    surfaces,
    resource: req.resource,
    redirectUri: req.redirectUri,
    codeChallenge: req.codeChallenge,
    grantId: grant.id,
    grantRevision: grant.grant_revision,
  });
  return redirect303(buildClientRedirect(req.redirectUri, { code, state: req.state }));
}
