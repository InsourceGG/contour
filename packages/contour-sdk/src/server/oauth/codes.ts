import "server-only";
import type { Scope } from "../../core/types";
import type { ServerContext } from "../context";
import { CODE_TTL_S } from "./config";
import { hashSecret, randomToken, TOKEN_PREFIX } from "./crypto";
import { OAuthError } from "./errors";

export type CodeRow = {
  code_hash: string | null;
  client_id: string;
  subject_id: string;
  tenant_id: string;
  app_id: string;
  scopes: string[];
  surfaces: string[];
  resource: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  grant_id: string | null;
  grant_revision: number | null;
};

export type AuthorizationCodes = ReturnType<typeof createCodes>;

export function createCodes(ctx: ServerContext) {
  /** Issues a single-use, 10-minute authorization code. Returns the plaintext once. */
  async function issueAuthorizationCode(p: {
    clientId: string;
    subjectId: string;
    tenantId: string;
    appId: string;
    scopes: Scope[];
    surfaces: string[];
    resource: string;
    redirectUri: string;
    codeChallenge: string;
    grantId: string;
    grantRevision: number;
  }): Promise<string> {
    const code = randomToken(TOKEN_PREFIX.code);
    const { error } = await ctx.db()
      .from("oauth_codes")
      .insert({
        code_hash: hashSecret(code),
        client_id: p.clientId,
        subject_id: p.subjectId,
        tenant_id: p.tenantId,
        app_id: p.appId,
        scopes: p.scopes,
        surfaces: p.surfaces,
        resource: p.resource,
        redirect_uri: p.redirectUri,
        code_challenge: p.codeChallenge,
        expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
        grant_id: p.grantId,
        grant_revision: p.grantRevision,
      });
    if (error) throw new OAuthError("server_error", "Could not issue authorization code", 500);
    return code;
  }

  /**
   * Atomically marks the code used (single statement in `contour_redeem_code`).
   * Returns null if unknown, expired or already used; `replayed` reports reuse.
   */
  async function redeemAuthorizationCode(code: string): Promise<{ row: CodeRow | null; replayed: CodeRow | null }> {
    if (!code.startsWith(TOKEN_PREFIX.code) || code.length > 128) return { row: null, replayed: null };
    const hash = hashSecret(code);
    const { data, error } = await ctx.db().rpc("contour_redeem_code", { p_code_hash: hash });
    if (error) throw new OAuthError("server_error", "Code redemption failed", 500);
    const row = (Array.isArray(data) ? data[0] : data) as CodeRow | null;
    if (row && row.code_hash) return { row, replayed: null };
    // Distinguish replay (used code) from unknown/expired, to revoke on replay.
    const { data: existing } = await ctx.db()
      .from("oauth_codes")
      .select("*")
      .eq("code_hash", hash)
      .not("used_at", "is", null)
      .maybeSingle();
    return { row: null, replayed: (existing as CodeRow | null) ?? null };
  }

  return { issueAuthorizationCode, redeemAuthorizationCode };
}
