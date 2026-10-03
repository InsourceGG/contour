import "server-only";
import { NO_STORE_HEADERS, resourceMetadataUrl } from "./config";

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "invalid_scope"
  | "invalid_target"
  | "access_denied"
  | "server_error"
  | "temporarily_unavailable"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "slow_down";

/** Protocol error for the authorization server endpoints (RFC 6749 §5.2 / RFC 7591 §3.2.2). */
export class OAuthError extends Error {
  constructor(
    public readonly error: OAuthErrorCode,
    public readonly description: string,
    public readonly status: number = 400,
  ) {
    super(description);
    this.name = "OAuthError";
  }
}

export function oauthErrorResponse(err: unknown, extraHeaders: Record<string, string> = {}): Response {
  const e =
    err instanceof OAuthError
      ? err
      : (console.error("[contour] oauth endpoint error", err instanceof Error ? err.message : "unknown"),
        new OAuthError("server_error", "Internal error", 500));
  const headers: Record<string, string> = { ...NO_STORE_HEADERS, ...extraHeaders };
  if (e.error === "invalid_client" && e.status === 401) headers["WWW-Authenticate"] = 'Basic realm="contour"';
  return Response.json({ error: e.error, error_description: e.description }, { status: e.status, headers });
}

/**
 * Resource-server authentication failure on /api/mcp. The route turns it into
 * 401/403 with an RFC 6750 + RFC 9728 `WWW-Authenticate` challenge.
 */
export class McpAuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    /** Absent when no token was presented (RFC 6750 §3.1). */
    public readonly error: "invalid_token" | "invalid_request" | "insufficient_scope" | null,
    public readonly description: string,
    public readonly requiredScope?: string,
  ) {
    super(description);
    this.name = "McpAuthError";
  }

  challenge(): string {
    const parts = [`resource_metadata="${resourceMetadataUrl()}"`];
    if (this.error) parts.push(`error="${this.error}"`);
    if (this.requiredScope) parts.push(`scope="${this.requiredScope}"`);
    if (this.error) parts.push(`error_description="${this.description.replace(/["\\]/g, "")}"`);
    return `Bearer ${parts.join(", ")}`;
  }
}
