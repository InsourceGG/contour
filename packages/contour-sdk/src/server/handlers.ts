import "server-only";
import { NextResponse } from "next/server";
import type { AdaptiveBroker } from "../core/broker";
import { ContourError } from "../core/types";
import type { ContourServer } from "./config";
import { errorResponse } from "./host/http";
import { methodNotAllowed } from "./mcp/handler";
import { brokerTools, DEFAULT_INSTRUCTIONS, type McpToolSet } from "./mcp/tools";
import { corsPreflight, PUBLIC_CORS_HEADERS } from "./oauth/http";
import { contourProjectResponse } from "./well-known";

/* eslint-disable @typescript-eslint/no-explicit-any -- Next passes a route-specific context object. */
export type ContourRouteHandler = (req: Request, ctx?: any) => Promise<Response>;

export type ContourHandlersOptions = {
  broker: AdaptiveBroker;
  /** Contour Cloud project ID; with `wellKnownNonce`, enables /.well-known/contour-project.json. */
  projectId?: string;
  wellKnownNonce?: string;
  /** MCP tool set and instructions. Defaults to `brokerTools(broker)` with generic instructions. */
  mcp?: { tools: McpToolSet; instructions: string };
};

async function params(ctx: unknown): Promise<Record<string, string | string[] | undefined>> {
  const p = (ctx as { params?: unknown } | undefined)?.params;
  return ((await p) as Record<string, string | string[] | undefined> | undefined) ?? {};
}

/** Optional catch-all `[[...path]]` suffix: only the root and `/api/mcp` are served (RFC 9728 path insertion). */
async function metadataSuffixOk(ctx: unknown): Promise<boolean> {
  const path = (await params(ctx)).path;
  const segs = Array.isArray(path) ? path : path ? [path] : [];
  const suffix = segs.length > 0 ? `/${segs.join("/")}` : "";
  return suffix === "" || suffix === "/api/mcp";
}

function metadataResponse(body: object): Response {
  return Response.json(body, { headers: { ...PUBLIC_CORS_HEADERS, "Cache-Control": "public, max-age=300" } });
}

const notFound = () => Response.json({ error: "not_found" }, { status: 404, headers: PUBLIC_CORS_HEADERS });

/**
 * Route handlers keyed by `"METHOD /path"`, using Next.js App Router route
 * names. Mount each with a one-line route file, e.g.
 * `export const POST = (req: Request) => handlers["POST /api/oauth/token"](req);`
 */
export function createContourHandlers(server: ContourServer, opts: ContourHandlersOptions): Record<string, ContourRouteHandler> {
  const { broker } = opts;
  const mcp = server.mcp(opts.mcp ?? { tools: brokerTools(broker), instructions: DEFAULT_INSTRUCTIONS });
  const preflight = async () => corsPreflight();

  async function revokeAgent(req: Request, ctx?: unknown): Promise<Response> {
    try {
      const grantId = String((await params(ctx)).grantId ?? "");
      const user = await server.requireUser();
      server.assertCsrf(req, user);
      const ok = await server.oauth.revokeGrant(user.subjectId, user.tenantId, grantId);
      if (!ok) throw new ContourError("NOT_FOUND", "Agent connection not found");
      return NextResponse.json({ revoked: true, grantId }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  }

  async function hostView(): Promise<Response> {
    try {
      const vc = server.contextFromUser(await server.requireUser());
      const snapshot = await broker.getSnapshot(vc);
      return NextResponse.json(
        { revision: snapshot.revision, configHash: snapshot.configHash, source: snapshot.source },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function hostLive(): Promise<Response> {
    try {
      const vc = server.contextFromUser(await server.requireUser());
      return NextResponse.json(await broker.getLive(vc), { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      const response = errorResponse(err);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
  }

  return {
    // OAuth discovery
    "GET /.well-known/oauth-protected-resource": async (_req, ctx) =>
      (await metadataSuffixOk(ctx)) ? metadataResponse(server.oauth.protectedResourceMetadata()) : notFound(),
    "OPTIONS /.well-known/oauth-protected-resource": preflight,
    "GET /.well-known/oauth-authorization-server": async (_req, ctx) =>
      (await metadataSuffixOk(ctx)) ? metadataResponse(server.oauth.authorizationServerMetadata()) : notFound(),
    "OPTIONS /.well-known/oauth-authorization-server": preflight,
    "GET /.well-known/contour-project.json": async () =>
      contourProjectResponse(server, { projectId: opts.projectId, nonce: opts.wellKnownNonce }),

    // Authorization server
    "POST /oauth/authorize/decision": (req) => server.oauth.decision(req),
    "POST /api/oauth/token": (req) => server.oauth.token(req),
    "OPTIONS /api/oauth/token": preflight,
    "POST /api/oauth/register": (req) => server.oauth.register(req),
    "OPTIONS /api/oauth/register": preflight,
    "POST /api/oauth/revoke": (req) => server.oauth.revoke(req),
    "OPTIONS /api/oauth/revoke": preflight,

    // MCP resource server
    "POST /api/mcp": (req) => mcp(req),
    "GET /api/mcp": async () => methodNotAllowed(),
    "DELETE /api/mcp": async () => methodNotAllowed(),

    // Host routes (verified session + same origin + CSRF)
    "GET /api/host/view": () => hostView(),
    "GET /api/host/live": () => hostLive(),
    "PUT /api/host/preferences": (req) => server.hostMutation(req, (vc, body) => broker.updatePreferences(vc, body)),
    "POST /api/host/proposals": (req) => server.hostMutation(req, (vc, body) => broker.proposeView(vc, body)),
    "POST /api/host/proposals/[id]/apply": async (req, ctx) => {
      const id = String((await params(ctx)).id ?? "");
      return server.hostMutation(req, (vc, body) => {
        const b = (body ?? {}) as Record<string, unknown>;
        return broker.applyProposal(vc, { proposalId: id, configHash: b.configHash, idempotencyKey: b.idempotencyKey });
      });
    },
    "POST /api/host/proposals/[id]/reject": async (req, ctx) => {
      const id = String((await params(ctx)).id ?? "");
      return server.hostMutation(req, (vc) => broker.rejectProposal(vc, id));
    },
    "POST /api/host/view/undo": (req) => server.hostMutation(req, (vc, body) => broker.undo(vc, body)),
    "POST /api/host/view/reset": (req) => server.hostMutation(req, (vc, body) => broker.reset(vc, body)),
    "POST /api/host/agents/[grantId]/revoke": revokeAgent,
  };
}
