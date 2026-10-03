import "server-only";
import { AGENT_SCOPES } from "@/sdk/types";
import { env } from "../env";

/** Lifetimes (seconds). */
export const CODE_TTL_S = 10 * 60;
export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;

/** Surfaces an agent grant may cover in the MVP. */
export const GRANTABLE_SURFACES = ["overview"] as const;

/** OAuth issuer identifier (RFC 8414): the deployment origin, no trailing slash. */
export function issuer(): string {
  return env.appUrl;
}

/** The single protected resource (RFC 8707 / RFC 9728 canonical URI). */
export function mcpResource(): string {
  return env.mcpResource;
}

/** Path-inserted RFC 9728 metadata URL for the MCP resource. */
export function resourceMetadataUrl(): string {
  const r = new URL(mcpResource());
  return `${r.origin}/.well-known/oauth-protected-resource${r.pathname === "/" ? "" : r.pathname}`;
}

export function authorizationServerMetadata() {
  const iss = issuer();
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

export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: [...AGENT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Contour adaptive dashboard (ops-demo)",
  };
}

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;
