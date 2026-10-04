import "server-only";
import { AGENT_SCOPES, ContourError, type Scope, type VerifiedContext } from "../../core/types";
import type { ServerContext } from "../context";
import { TOKEN_PREFIX } from "./crypto";
import { McpAuthError } from "./errors";
import type { Grants } from "./grants";
import type { Tokens } from "./tokens";

const BEARER_RE = /^Bearer[ ]+([A-Za-z0-9\-._~+/]+=*)[ ]*$/i;

function invalid(description: string): McpAuthError {
  return new McpAuthError(401, "invalid_token", description);
}

export function createResolver(ctx: ServerContext, deps: { grants: Grants; tokens: Tokens }) {
  const { grants, tokens } = deps;

  /**
   * Verifies the bearer token on an MCP request and builds the broker context.
   * Identity (subject, tenant, app, client, role, scopes) comes only from the
   * server-side token, grant and membership records; never from MCP arguments.
   * Everything is re-checked on every request (no caching).
   *
   * Throws McpAuthError (route -> 401/403 + WWW-Authenticate) for credential
   * problems and ContourError("AGENT_ACCESS_DISABLED") for the company kill switch.
   */
  async function resolveMcpContext(request: Request, surfaceId: string): Promise<VerifiedContext> {
    const header = request.headers.get("authorization");
    if (!header) throw new McpAuthError(401, null, "Authorization required");
    const m = BEARER_RE.exec(header);
    if (!m) throw new McpAuthError(401, "invalid_request", "Malformed Authorization header; expected a Bearer token");
    const value = m[1];
    if (!value.startsWith(TOKEN_PREFIX.access)) throw invalid("The access token is invalid");

    let token;
    try {
      token = await tokens.getTokenByValue(value);
    } catch {
      throw new ContourError("INTERNAL", "Token verification is temporarily unavailable");
    }
    if (!token || token.kind !== "access") throw invalid("The access token is invalid");
    if (token.revoked_at) throw invalid("The access token has been revoked");
    if (Date.parse(token.expires_at) <= Date.now()) throw invalid("The access token has expired");
    // Audience binding (RFC 8707): tokens minted for any other resource are rejected.
    if (token.resource !== ctx.mcpResource()) throw invalid("The access token was not issued for this resource");

    const grant = await grants.getGrantById(token.grant_id);
    if (!grant || grant.revoked_at) throw invalid("The authorization has been revoked");
    if (grant.grant_revision !== token.grant_revision) throw invalid("The authorization was superseded by a newer consent");
    if (grant.app_id !== ctx.cfg.appId) throw invalid("The access token is not valid for this app");

    const member = await tokens.getActiveMembership(grant.subject_id, grant.tenant_id, grant.app_id);
    if (!member) throw invalid("The user no longer has access to this app");
    if (!(await tokens.isAgentAccessEnabled(grant.tenant_id, grant.app_id))) {
      throw new ContourError("AGENT_ACCESS_DISABLED", "The company has disabled agent access for this app");
    }
    if (!grant.surfaces.includes(surfaceId)) {
      throw new McpAuthError(403, "insufficient_scope", `Surface "${surfaceId}" is not covered by this authorization`);
    }

    const scopes = new Set<Scope>(AGENT_SCOPES.filter((s) => token.scopes.includes(s) && grant.scopes.includes(s)));
    return {
      subjectId: grant.subject_id,
      tenantId: grant.tenant_id,
      appId: grant.app_id,
      surfaceId,
      clientId: grant.client_id,
      grantRevision: `${grant.id}:${grant.grant_revision}`,
      scopes,
      roleVersion: String(member.roleVersion),
      role: member.role,
      channel: "mcp",
    };
  }

  return { resolveMcpContext };
}

/** 403 insufficient_scope with the scope the operation needs (MCP step-up). */
export function requireMcpScope(ctx: VerifiedContext, scope: Scope) {
  if (!ctx.scopes.has(scope)) {
    throw new McpAuthError(403, "insufficient_scope", `This operation requires the ${scope} scope`, scope);
  }
}
