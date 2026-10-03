import "server-only";
import { AGENT_SCOPES, type Scope } from "@/sdk/types";
import { adminClient } from "../supabase";
import { ACCESS_TOKEN_TTL_S, mcpResource, REFRESH_TOKEN_TTL_S } from "./config";
import { getClient } from "./clients";
import { redeemAuthorizationCode } from "./codes";
import { hashSecret, randomToken, safeEqual, TOKEN_PREFIX, verifyPkceS256 } from "./crypto";
import { OAuthError } from "./errors";
import { agentScopesOnly, getGrantById, revokeGrantForSecurityEvent, revokeTokensForGrants, type GrantRow } from "./grants";
import { isOurResource } from "./authorize";

export type TokenRow = {
  token_hash: string;
  grant_id: string;
  kind: "access" | "refresh";
  resource: string;
  scopes: string[];
  grant_revision: number;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  refresh_token: string;
};

export async function getTokenByValue(value: string): Promise<TokenRow | null> {
  if (value.length < 20 || value.length > 128) return null;
  const { data, error } = await adminClient()
    .from("oauth_tokens")
    .select("token_hash, grant_id, kind, resource, scopes, grant_revision, expires_at, revoked_at, replaced_by, created_at")
    .eq("token_hash", hashSecret(value))
    .maybeSingle();
  if (error) throw new Error("token lookup failed");
  return (data as TokenRow | null) ?? null;
}

export async function getActiveMembership(subjectId: string, tenantId: string, appId: string) {
  const { data, error } = await adminClient()
    .from("memberships")
    .select("role, role_version, status, data_access")
    .eq("subject_id", subjectId)
    .eq("tenant_id", tenantId)
    .eq("app_id", appId)
    .maybeSingle();
  if (error) throw new Error("membership lookup failed");
  if (!data || data.status !== "active") return null;
  return data as { role: string; role_version: number; status: string; data_access: boolean };
}

import { isAgentAccessEnabled } from "../agent-access";
export { isAgentAccessEnabled };

async function assertGrantUsable(grant: GrantRow | null, expectedRevision: number): Promise<GrantRow> {
  if (!grant || grant.revoked_at) throw new OAuthError("invalid_grant", "The authorization has been revoked");
  if (grant.grant_revision !== expectedRevision) throw new OAuthError("invalid_grant", "The authorization was superseded by a newer consent");
  const member = await getActiveMembership(grant.subject_id, grant.tenant_id, grant.app_id);
  if (!member) throw new OAuthError("invalid_grant", "The user no longer has access to this app");
  if (!(await isAgentAccessEnabled(grant.tenant_id, grant.app_id))) throw new OAuthError("invalid_grant", "Agent access is disabled for this app");
  return grant;
}

async function issueTokenPair(grant: GrantRow, scopes: Scope[]): Promise<{ response: TokenResponse; refreshHash: string; rows: object[] }> {
  const access = randomToken(TOKEN_PREFIX.access);
  const refresh = randomToken(TOKEN_PREFIX.refresh);
  const now = Date.now();
  const base = { grant_id: grant.id, resource: mcpResource(), scopes, grant_revision: grant.grant_revision };
  const rows = [
    { ...base, token_hash: hashSecret(access), kind: "access", expires_at: new Date(now + ACCESS_TOKEN_TTL_S * 1000).toISOString() },
    { ...base, token_hash: hashSecret(refresh), kind: "refresh", expires_at: new Date(now + REFRESH_TOKEN_TTL_S * 1000).toISOString() },
  ];
  return {
    response: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, scope: scopes.join(" "), refresh_token: refresh },
    refreshHash: rows[1].token_hash,
    rows,
  };
}

async function insertTokens(rows: object[]) {
  const { error } = await adminClient().from("oauth_tokens").insert(rows);
  if (error) throw new OAuthError("server_error", "Could not issue tokens", 500);
}

function requireParam(params: URLSearchParams, name: string): string {
  const all = params.getAll(name);
  if (all.length > 1) throw new OAuthError("invalid_request", `Duplicate ${name} parameter`);
  const v = all[0];
  if (!v) throw new OAuthError("invalid_request", `Missing ${name}`);
  return v;
}

function optionalParam(params: URLSearchParams, name: string): string | undefined {
  const all = params.getAll(name);
  if (all.length > 1) throw new OAuthError("invalid_request", `Duplicate ${name} parameter`);
  return all[0] || undefined;
}

// ------------------------------------------------- authorization_code grant

export async function exchangeAuthorizationCode(params: URLSearchParams, clientId: string): Promise<TokenResponse> {
  const code = requireParam(params, "code");
  const redirectUri = requireParam(params, "redirect_uri");
  const verifier = requireParam(params, "code_verifier");
  const resource = optionalParam(params, "resource");
  const client = await getClient(clientId, { allowFetch: false }).catch(() => {
    throw new OAuthError("invalid_client", "Unknown client", 401);
  });

  const { row, replayed } = await redeemAuthorizationCode(code);
  if (!row) {
    if (replayed && replayed.client_id === client.clientId && replayed.grant_id) {
      // RFC 6749 §4.1.2 / OAuth 2.1 §4.1.3: a reused code means it leaked.
      // Revoke everything issued under that grant.
      await revokeTokensForGrants([replayed.grant_id]);
    }
    throw new OAuthError("invalid_grant", "Authorization code is invalid, expired or already used");
  }
  if (row.client_id !== client.clientId) throw new OAuthError("invalid_grant", "Authorization code was issued to another client");
  if (!safeEqual(row.redirect_uri, redirectUri)) throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
  if (!verifyPkceS256(verifier, row.code_challenge)) throw new OAuthError("invalid_grant", "PKCE verification failed");
  if (resource !== undefined && (!isOurResource(resource) || row.resource !== mcpResource())) {
    throw new OAuthError("invalid_target", "resource does not match the authorization request");
  }
  if (row.resource !== mcpResource() || !row.grant_id || row.grant_revision === null) {
    throw new OAuthError("invalid_grant", "Authorization code is not valid for this resource");
  }
  const grant = await assertGrantUsable(await getGrantById(row.grant_id), row.grant_revision);
  if (
    grant.subject_id !== row.subject_id ||
    grant.tenant_id !== row.tenant_id ||
    grant.app_id !== row.app_id ||
    grant.client_id !== row.client_id
  ) {
    throw new OAuthError("invalid_grant", "Authorization code does not match its grant");
  }
  const scopes = agentScopesOnly(row.scopes).filter((s) => grant.scopes.includes(s));
  if (scopes.length === 0) throw new OAuthError("invalid_scope", "No grantable scopes");
  const { response, rows } = await issueTokenPair(grant, scopes);
  await insertTokens(rows);
  return response;
}

// ------------------------------------------------------ refresh_token grant

export async function refreshAccessToken(params: URLSearchParams, clientId: string): Promise<TokenResponse> {
  const presented = requireParam(params, "refresh_token");
  const resource = optionalParam(params, "resource");
  const scopeParam = optionalParam(params, "scope");
  if (resource !== undefined && !isOurResource(resource)) throw new OAuthError("invalid_target", `Tokens are only issued for ${mcpResource()}`);

  const row = presented.startsWith(TOKEN_PREFIX.refresh) ? await getTokenByValue(presented) : null;
  if (!row || row.kind !== "refresh") throw new OAuthError("invalid_grant", "Refresh token is invalid");
  const grant = await getGrantById(row.grant_id);
  if (!grant || grant.client_id !== clientId) throw new OAuthError("invalid_grant", "Refresh token is invalid");

  if (row.replaced_by) {
    // Reuse of a rotated refresh token: assume theft, revoke the whole grant.
    await revokeGrantForSecurityEvent(grant, "refresh_token_reuse");
    throw new OAuthError("invalid_grant", "Refresh token was already used; the authorization has been revoked");
  }
  if (row.revoked_at) throw new OAuthError("invalid_grant", "Refresh token has been revoked");
  if (Date.parse(row.expires_at) <= Date.now()) throw new OAuthError("invalid_grant", "Refresh token has expired");
  if (row.resource !== mcpResource()) throw new OAuthError("invalid_grant", "Refresh token is not valid for this resource");
  await assertGrantUsable(grant, row.grant_revision);

  let scopes = agentScopesOnly(row.scopes).filter((s) => grant.scopes.includes(s));
  if (scopeParam !== undefined && scopeParam.trim() !== "") {
    // Narrowing only. Non-agent values (e.g. offline_access, view:commit) are
    // ignored, never granted; asking for an agent scope outside the original
    // grant is an error.
    const requested = AGENT_SCOPES.filter((s) => scopeParam.split(" ").includes(s));
    if (requested.length === 0 || requested.some((s) => !scopes.includes(s))) {
      throw new OAuthError("invalid_scope", "Requested scope exceeds the original grant");
    }
    scopes = requested;
  }

  const { response, refreshHash, rows } = await issueTokenPair(grant, scopes);
  // Claim the old refresh token atomically: only one concurrent refresh wins.
  const { data: claimed, error } = await adminClient()
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString(), replaced_by: refreshHash })
    .eq("token_hash", row.token_hash)
    .eq("grant_id", grant.id)
    .is("revoked_at", null)
    .is("replaced_by", null)
    .select("token_hash");
  if (error) throw new OAuthError("server_error", "Refresh failed", 500);
  if (!claimed || claimed.length === 0) {
    await revokeGrantForSecurityEvent(grant, "refresh_token_race");
    throw new OAuthError("invalid_grant", "Refresh token was already used; the authorization has been revoked");
  }
  await insertTokens(rows);
  return response;
}

// ------------------------------------------------------- RFC 7009 revocation

export async function revokePresentedToken(token: string, clientId: string | undefined): Promise<void> {
  const row = await getTokenByValue(token).catch(() => null);
  if (!row) return; // RFC 7009 §2.2: invalid tokens do not cause an error.
  const grant = await getGrantById(row.grant_id);
  if (!grant) return;
  if (clientId !== undefined && grant.client_id !== clientId) return;
  if (row.kind === "refresh") {
    // §2.1: revoking a refresh token SHOULD also invalidate its access tokens.
    await revokeTokensForGrants([grant.id]);
    return;
  }
  await adminClient()
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", row.token_hash)
    .eq("grant_id", grant.id)
    .is("revoked_at", null);
}
