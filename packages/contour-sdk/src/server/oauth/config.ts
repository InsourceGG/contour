import "server-only";
import { AGENT_SCOPES } from "../../core/types";
import type { ServerContext } from "../context";

/** Lifetimes (seconds). */
export const CODE_TTL_S = 10 * 60;
export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;

export function authorizationServerMetadata(ctx: ServerContext) {
  const iss = ctx.issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/api/oauth/token`,
    registration_endpoint: `${iss}/api/oauth/register`,
    revocation_endpoint: `${iss}/api/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...AGENT_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata(ctx: ServerContext) {
  return {
    resource: ctx.mcpResource(),
    authorization_servers: [ctx.issuer()],
    scopes_supported: [...AGENT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: ctx.cfg.resourceName,
  };
}

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;
