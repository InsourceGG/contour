import "server-only";
import { AGENT_SCOPES, type Scope } from "@/sdk/types";
import { issuer, mcpResource } from "./config";
import { getClient, type OAuthClient } from "./clients";
import { isValidCodeChallenge } from "./crypto";
import { OAuthError, type OAuthErrorCode } from "./errors";
import { isLoopbackRedirect, matchRedirectUri } from "./redirect";

export type RawParams = Record<string, string | string[] | undefined>;

export type AuthorizeRequest = {
  client: OAuthClient;
  clientId: string;
  redirectUri: string;
  scopes: Scope[];
  state: string | null;
  codeChallenge: string;
  resource: string;
  loopbackRedirect: boolean;
};

export type AuthorizeValidation =
  | { kind: "ok"; request: AuthorizeRequest }
  /** client_id or redirect_uri invalid: MUST NOT redirect; render an error. */
  | { kind: "fatal"; message: string }
  /** Valid client + redirect_uri: report the error to the client via redirect. */
  | { kind: "redirect_error"; redirectUri: string; state: string | null; error: OAuthErrorCode; description: string };

/** The parameters echoed through the consent form and re-validated on POST. */
export const AUTHORIZE_PARAM_NAMES = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "resource",
  "scope",
  "state",
] as const;

function single(raw: RawParams, name: string): { value: string | undefined; duplicated: boolean } {
  const v = raw[name];
  if (Array.isArray(v)) return { value: v[0], duplicated: v.length > 1 };
  return { value: v, duplicated: false };
}

/**
 * RFC 8707 resource comparison against our canonical MCP resource. Scheme and
 * host are case-insensitive and a single trailing slash is tolerated; any
 * other difference (path, port, query, fragment) is a different resource.
 */
export function isOurResource(resource: string | undefined | null): boolean {
  if (!resource || resource.length > 512) return false;
  let u: URL;
  let ours: URL;
  try {
    u = new URL(resource);
    ours = new URL(mcpResource());
  } catch {
    return false;
  }
  if (u.hash || resource.includes("#") || u.search || u.username || u.password) return false;
  const strip = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);
  return u.origin === ours.origin && strip(u.pathname) === strip(ours.pathname);
}

export function parseRequestedScopes(scope: string | undefined): { scopes: Scope[]; error?: string } {
  if (scope === undefined || scope.trim() === "") return { scopes: [...AGENT_SCOPES] };
  if (scope.length > 512) return { scopes: [], error: "scope parameter is too long" };
  const requested = scope.split(" ").filter(Boolean);
  // view:commit and anything else outside the agent set are never granted.
  const scopes = AGENT_SCOPES.filter((s) => requested.includes(s));
  if (scopes.length === 0) {
    return { scopes: [], error: `None of the requested scopes can be granted. Grantable scopes: ${AGENT_SCOPES.join(" ")}` };
  }
  return { scopes };
}

export async function validateAuthorizeRequest(raw: RawParams): Promise<AuthorizeValidation> {
  const clientIdP = single(raw, "client_id");
  const redirectP = single(raw, "redirect_uri");
  if (clientIdP.duplicated || redirectP.duplicated) return { kind: "fatal", message: "Duplicate client_id or redirect_uri parameter." };
  if (!clientIdP.value) return { kind: "fatal", message: "Missing client_id." };

  let client: OAuthClient;
  try {
    client = await getClient(clientIdP.value, { allowFetch: true });
  } catch (e) {
    const msg = e instanceof OAuthError ? e.description : "Client lookup failed.";
    return { kind: "fatal", message: `This application could not be identified: ${msg}` };
  }
  const redirectUri = redirectP.value;
  if (!redirectUri) return { kind: "fatal", message: "Missing redirect_uri." };
  if (!matchRedirectUri(redirectUri, client.redirectUris)) {
    return { kind: "fatal", message: "The redirect_uri is not registered for this application." };
  }

  const stateP = single(raw, "state");
  const state = stateP.value ?? null;
  const fail = (error: OAuthErrorCode, description: string): AuthorizeValidation => ({
    kind: "redirect_error",
    redirectUri,
    state: state && state.length <= 1024 ? state : null,
    error,
    description,
  });

  for (const n of AUTHORIZE_PARAM_NAMES) {
    if (single(raw, n).duplicated) return fail("invalid_request", `Duplicate ${n} parameter`);
  }
  if (state !== null && state.length > 1024) return fail("invalid_request", "state is too long");

  const responseType = single(raw, "response_type").value;
  if (responseType !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");

  const challenge = single(raw, "code_challenge").value;
  const method = single(raw, "code_challenge_method").value;
  if (!challenge) return fail("invalid_request", "code_challenge is required (PKCE)");
  if (method !== "S256") return fail("invalid_request", "code_challenge_method must be S256");
  if (!isValidCodeChallenge(challenge)) return fail("invalid_request", "code_challenge is malformed");

  const resource = single(raw, "resource").value;
  if (!resource) return fail("invalid_target", `resource is required and must be ${mcpResource()}`);
  if (!isOurResource(resource)) return fail("invalid_target", `Unknown resource; this server only issues tokens for ${mcpResource()}`);

  const { scopes, error: scopeError } = parseRequestedScopes(single(raw, "scope").value);
  if (scopeError) return fail("invalid_scope", scopeError);

  return {
    kind: "ok",
    request: {
      client,
      clientId: client.clientId,
      redirectUri,
      scopes,
      state,
      codeChallenge: challenge,
      resource: mcpResource(),
      loopbackRedirect: isLoopbackRedirect(redirectUri),
    },
  };
}

/** Builds the client redirect for a code or an error, including RFC 9207 `iss`. */
export function buildClientRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  u.searchParams.set("iss", issuer());
  return u.toString();
}

/** Relative URL of this authorize request (for /login?next=...). */
export function authorizePathFor(raw: RawParams): string {
  const qs = new URLSearchParams();
  for (const n of AUTHORIZE_PARAM_NAMES) {
    const v = single(raw, n).value;
    if (v !== undefined) qs.set(n, v);
  }
  return `/oauth/authorize?${qs.toString()}`;
}
