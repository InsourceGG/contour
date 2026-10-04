import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContourStore, Membership } from "../core/broker";
import type { VerifiedContext } from "../core/types";
import { createServerContext } from "./context";
import { createCsrf } from "./host/csrf";
import { createHostRoute } from "./host/host-route";
import { createMcpHandler } from "./mcp/handler";
import type { McpToolSet } from "./mcp/tools";
import { createAuthorize, type AuthorizeValidation, type RawParams } from "./oauth/authorize";
import { createClients } from "./oauth/clients";
import { createCodes } from "./oauth/codes";
import { authorizationServerMetadata, NO_STORE_HEADERS, protectedResourceMetadata } from "./oauth/config";
import { createConsent } from "./oauth/consent";
import { OAuthError, oauthErrorResponse } from "./oauth/errors";
import { createGrants, type GrantSummary } from "./oauth/grants";
import { PUBLIC_CORS_HEADERS, publicClientId, readBodyCapped, readFormBody } from "./oauth/http";
import { clientIp, createRateLimiter } from "./oauth/ratelimit";
import { createResolver } from "./oauth/resolve";
import { createTokens } from "./oauth/tokens";
import { supabaseStore } from "./store/supabase-store";

export type { Membership };

/** A verified company session, resolved by the host's own auth. */
export type HostUser = {
  subjectId: string;
  /** Auth session ID; binds CSRF tokens to this sign-in. */
  sessionId: string;
  tenantId: string;
  role: string;
  roleVersion: number;
  displayName: string;
  email: string;
};

export type ContourServerConfig = {
  /** Public origin of the deployment, no trailing slash. OAuth issuer; the MCP resource is `${appUrl}/api/mcp`. */
  appUrl: string;
  appId: string;
  /** Shown in protected resource metadata and on consent. */
  resourceName: string;
  /** Grantable surfaces. The first one is the default (host sessions, MCP connection check). */
  surfaces: readonly string[];
  /** Service-role client. Never exposed to browsers, agents or prompts. */
  db: SupabaseClient;
  /** Postgres schema with the Contour and OAuth tables: "public" for ops-demo. */
  schema: string;
  csrfSecret: string;
  identity: {
    /**
     * The verified company session, or null when signed out. May throw
     * ContourError("FORBIDDEN") when the user is signed in but has no active
     * membership for this app.
     */
    currentUser(): Promise<HostUser | null>;
    /** Relative path in the host app that signs the user in, then returns to `nextPath`. */
    loginUrl(nextPath: string): string;
    /**
     * Membership for a subject in a tenant and app. The store delegates to this,
     * so it must read the host's own records and must not call `store.getMembership`.
     */
    getMembership(subjectId: string, tenantId: string, appId: string): Promise<Membership | null>;
  };
  /** Company-wide and tenant agent switch for MCP access (both must be on). */
  agentAccessEnabled(tenantId: string, appId: string): Promise<boolean>;
  /** Client ID Metadata Document URLs shown as verified on consent (e.g. Contour Cloud). */
  trustedClients?: readonly string[];
  /**
   * "credits" (default): each READY proposal consumes one prepaid credit.
   * "none": unmetered; no credits are required, reserved or consumed.
   */
  billing?: "credits" | "none";
  consent?: { productName: string; dataCategories: string[]; brandColor?: string };
};

export type ContourServer = {
  config: ContourServerConfig;
  /** Verifies the MCP bearer token and builds the broker context for `surfaceId`. */
  resolveMcpContext(req: Request, surfaceId: string): Promise<VerifiedContext>;
  oauth: {
    protectedResourceMetadata(): object;
    authorizationServerMetadata(): object;
    validateAuthorize(raw: Record<string, string | string[] | undefined>): Promise<AuthorizeValidation>;
    /** Builds the client redirect for a code or an error, including RFC 9207 `iss`. */
    buildClientRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string;
    /** Consent form POST (Approve / Deny). */
    decision(req: Request): Promise<Response>;
    token(req: Request): Promise<Response>;
    register(req: Request): Promise<Response>;
    revoke(req: Request): Promise<Response>;
    csrfTokenFor(user: HostUser): string;
    listGrantsForUser(subjectId: string, tenantId: string): Promise<GrantSummary[]>;
    revokeGrant(subjectId: string, tenantId: string, grantId: string): Promise<boolean>;
    revokeAllGrantsForApp(tenantId: string, appId: string, by?: string): Promise<number>;
  };
  /** Builds the MCP POST handler for a tool set. */
  mcp(handlerOpts: { tools: McpToolSet; instructions: string }): (req: Request) => Promise<Response>;
  /** supabaseStore({ client: db, schema }) with this config's agent switch and identity membership. */
  store: ContourStore;
  /** Same-origin + session-bound CSRF header check for host mutations. Throws ContourError FORBIDDEN. */
  assertCsrf(req: Request, user: HostUser): void;
  /** The verified host session; throws ContourError UNAUTHENTICATED when signed out. */
  requireUser(): Promise<HostUser>;
  /** Broker context for a verified host session (all scopes, host channel). */
  contextFromUser(user: HostUser, surfaceId?: string): VerifiedContext;
  /** Authenticated host mutation: verified session + same origin + CSRF + JSON body (32 KB cap). */
  hostMutation(req: Request, fn: (ctx: VerifiedContext, body: unknown) => Promise<unknown>): Promise<Response>;
};

const MAX_REGISTRATION_BODY = 8 * 1024;

/**
 * Builds the OAuth 2.1 authorization server, MCP resource server, store and
 * host helpers for one app. Nothing is read from the config at construction
 * time, so config getters (env-backed values, a lazily created client) stay
 * lazy and live.
 */
export function defineContourServer(cfg: ContourServerConfig): ContourServer {
  const ctx = createServerContext(cfg);
  const csrf = createCsrf(ctx);
  const rateLimiter = createRateLimiter(ctx);
  const clients = createClients(ctx, rateLimiter);
  const codes = createCodes(ctx);
  const grants = createGrants(ctx);
  const authorize = createAuthorize(ctx, clients);
  const tokens = createTokens(ctx, { clients, codes, grants, authorize });
  const resolver = createResolver(ctx, { grants, tokens });
  const consent = createConsent(ctx, { csrf, authorize, grants, codes });
  const host = createHostRoute(ctx, csrf);
  const store = supabaseStore({
    client: () => cfg.db,
    schema: cfg.schema,
    billing: cfg.billing ?? "credits",
    agentAccessEnabled: (tenantId, appId) => cfg.agentAccessEnabled(tenantId, appId),
    // Resolved per call so a getter-backed identity config stays lazy. The
    // identity adapter must not call `store.getMembership` (it would recurse).
    getMembership: (subjectId, tenantId, appId) => cfg.identity.getMembership(subjectId, tenantId, appId),
  });

  /** OAuth 2.1 token endpoint: authorization_code (+PKCE S256) and refresh_token (rotating). */
  async function token(request: Request): Promise<Response> {
    try {
      if (!(await rateLimiter.allowRequest("token", clientIp(request), 60, 60))) {
        throw new OAuthError("temporarily_unavailable", "Too many token requests; retry shortly", 429);
      }
      const params = await readFormBody(request);
      const grantTypes = params.getAll("grant_type");
      if (grantTypes.length !== 1) throw new OAuthError("invalid_request", "grant_type is required exactly once");
      const clientId = publicClientId(request, params);
      let body;
      if (grantTypes[0] === "authorization_code") body = await tokens.exchangeAuthorizationCode(params, clientId);
      else if (grantTypes[0] === "refresh_token") body = await tokens.refreshAccessToken(params, clientId);
      else throw new OAuthError("unsupported_grant_type", "Supported grant types: authorization_code, refresh_token");
      return Response.json(body, { headers: { ...NO_STORE_HEADERS, ...PUBLIC_CORS_HEADERS } });
    } catch (e) {
      return oauthErrorResponse(e, PUBLIC_CORS_HEADERS);
    }
  }

  /** RFC 7591 Dynamic Client Registration (public clients only). */
  async function register(request: Request): Promise<Response> {
    try {
      if (!(await rateLimiter.allowRequest("dcr", clientIp(request), 3600, 60))) {
        throw new OAuthError("temporarily_unavailable", "Too many registrations from this address; retry later", 429);
      }
      const type = request.headers.get("content-type") ?? "";
      if (!type.toLowerCase().startsWith("application/json")) {
        throw new OAuthError("invalid_client_metadata", "Content-Type must be application/json");
      }
      let body: unknown;
      try {
        body = JSON.parse(await readBodyCapped(request, MAX_REGISTRATION_BODY));
      } catch (e) {
        if (e instanceof OAuthError) throw e;
        throw new OAuthError("invalid_client_metadata", "Body must be valid JSON");
      }
      const registered = await clients.registerDynamicClient(body);
      return Response.json(registered, { status: 201, headers: { ...NO_STORE_HEADERS, ...PUBLIC_CORS_HEADERS } });
    } catch (e) {
      return oauthErrorResponse(e, PUBLIC_CORS_HEADERS);
    }
  }

  /** RFC 7009 token revocation. Always 200 for well-formed requests (§2.2). */
  async function revoke(request: Request): Promise<Response> {
    try {
      if (!(await rateLimiter.allowRequest("revoke", clientIp(request), 60, 60))) {
        throw new OAuthError("temporarily_unavailable", "Too many requests; retry shortly", 429);
      }
      const params = await readFormBody(request);
      const presented = params.getAll("token");
      if (presented.length !== 1 || !presented[0]) throw new OAuthError("invalid_request", "token is required exactly once");
      const clientIds = params.getAll("client_id");
      if (clientIds.length > 1) throw new OAuthError("invalid_request", "Duplicate client_id parameter");
      await tokens.revokePresentedToken(presented[0], clientIds[0] || undefined);
      return new Response(null, { status: 200, headers: { ...NO_STORE_HEADERS, ...PUBLIC_CORS_HEADERS } });
    } catch (e) {
      return oauthErrorResponse(e, PUBLIC_CORS_HEADERS);
    }
  }

  return {
    config: cfg,
    resolveMcpContext: resolver.resolveMcpContext,
    oauth: {
      protectedResourceMetadata: () => protectedResourceMetadata(ctx),
      authorizationServerMetadata: () => authorizationServerMetadata(ctx),
      validateAuthorize: (raw: RawParams) => authorize.validateAuthorizeRequest(raw),
      buildClientRedirect: authorize.buildClientRedirect,
      decision: consent.handleConsentDecision,
      token,
      register,
      revoke,
      csrfTokenFor: (user) => csrf.csrfTokenFor(user),
      listGrantsForUser: grants.listGrantsForUser,
      revokeGrant: grants.revokeGrant,
      revokeAllGrantsForApp: grants.revokeAllGrantsForApp,
    },
    mcp: (handlerOpts) => createMcpHandler(ctx, resolver.resolveMcpContext, handlerOpts),
    store,
    assertCsrf: (req, user) => csrf.assertCsrf(req, user),
    requireUser: host.requireUser,
    contextFromUser: host.contextFromUser,
    hostMutation: host.hostMutation,
  };
}
