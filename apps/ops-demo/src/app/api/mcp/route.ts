import { handleMcpPost, methodNotAllowed } from "@/server/mcp/handler";

/**
 * Contour MCP endpoint (Streamable HTTP, stateless, JSON responses).
 * Every request needs `Authorization: Bearer <token>` from Contour's OAuth
 * server; without one the response is 401 with a WWW-Authenticate challenge
 * pointing at /.well-known/oauth-protected-resource/api/mcp.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcpPost(request);
}

/** No standalone SSE stream and no sessions in this server. */
export function GET() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}
