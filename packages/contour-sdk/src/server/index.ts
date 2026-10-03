/**
 * @contour/sdk/server: config-driven OAuth 2.1 authorization server, MCP
 * resource server, Supabase store and host-route helpers. Server only.
 */
import "server-only";

export {
  defineContourServer,
  type ContourServer,
  type ContourServerConfig,
  type HostUser,
  type Membership,
} from "./config";
export { createContourHandlers, type ContourHandlersOptions, type ContourRouteHandler } from "./handlers";
export { contourProjectDocument, contourProjectResponse, type ContourProjectDocument } from "./well-known";

// MCP
export {
  brokerTools,
  DEFAULT_INSTRUCTIONS,
  type BrokerToolName,
  type BrokerToolsOptions,
  type McpToolSet,
  type ToolDef,
} from "./mcp/tools";
export { methodNotAllowed, SERVER_INFO, MODERN_VERSIONS, LEGACY_VERSIONS } from "./mcp/handler";

// OAuth
export {
  AUTHORIZE_PARAM_NAMES,
  authorizePathFor,
  parseRequestedScopes,
  type AuthorizeRequest,
  type AuthorizeValidation,
  type RawParams,
} from "./oauth/authorize";
export type { OAuthClient } from "./oauth/clients";
export { ACCESS_TOKEN_TTL_S, CODE_TTL_S, NO_STORE_HEADERS, REFRESH_TOKEN_TTL_S } from "./oauth/config";
export { errorPage } from "./oauth/consent";
export { McpAuthError, OAuthError, oauthErrorResponse, type OAuthErrorCode } from "./oauth/errors";
export type { GrantSummary } from "./oauth/grants";
export { corsPreflight, PUBLIC_CORS_HEADERS } from "./oauth/http";
export { clientIp } from "./oauth/ratelimit";
export { requireMcpScope } from "./oauth/resolve";

// Store
export { supabaseStore, type SupabaseStoreOptions } from "./store/supabase-store";

// Host helpers
export { CSRF_HEADER } from "./host/csrf";
export { errorResponse, statusFor, toContourError } from "./host/http";

// Outbound fetch for untrusted URLs
export { isPrivateAddress, PinnedFetchError, pinnedFetchJson, type PinnedFetchFailure } from "./net/pinned-fetch";
