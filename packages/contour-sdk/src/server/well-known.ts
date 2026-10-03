import "server-only";
import type { ContourServer } from "./config";
import { PUBLIC_CORS_HEADERS } from "./oauth/http";

/** `/.well-known/contour-project.json`: lets Contour Cloud verify that this deployment owns `projectId`. */
export type ContourProjectDocument = {
  projectId: string;
  nonce: string;
  /** The MCP resource agents call through Cloud (`${appUrl}/api/mcp`). */
  agentApiResource: string;
  /** OAuth issuer of this deployment. */
  authorizationServer: string;
};

export function contourProjectDocument(server: ContourServer, opts: { projectId: string; nonce: string }): ContourProjectDocument {
  const meta = server.oauth.protectedResourceMetadata() as { resource: string; authorization_servers: string[] };
  return {
    projectId: opts.projectId,
    nonce: opts.nonce,
    agentApiResource: meta.resource,
    authorizationServer: meta.authorization_servers[0],
  };
}

/** GET handler. 404 until the project ID and verification nonce are configured. */
export function contourProjectResponse(server: ContourServer, opts: { projectId?: string; nonce?: string }): Response {
  if (!opts.projectId || !opts.nonce) {
    return Response.json({ error: "not_found" }, { status: 404, headers: { ...PUBLIC_CORS_HEADERS, "Cache-Control": "no-store" } });
  }
  return Response.json(contourProjectDocument(server, { projectId: opts.projectId, nonce: opts.nonce }), {
    headers: { ...PUBLIC_CORS_HEADERS, "Cache-Control": "no-store" },
  });
}
