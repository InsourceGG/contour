import { methodNotAllowed } from "@contour/sdk/server";
import { contour } from "@/server/contour";
import { agentTools, SERVER_INSTRUCTIONS } from "@/server/agent-tools";

/**
 * Contour MCP endpoint (Streamable HTTP, stateless, JSON responses).
 * Every request needs `Authorization: Bearer <token>` from Contour's OAuth
 * server; without one the response is 401 with a WWW-Authenticate challenge
 * pointing at /.well-known/oauth-protected-resource/api/mcp.
 */
export const dynamic = "force-dynamic";

let handler: ((request: Request) => Promise<Response>) | null = null;

export async function POST(request: Request) {
  handler ??= contour.mcp({ tools: agentTools(), instructions: SERVER_INSTRUCTIONS });
  return handler(request);
}

/** No standalone SSE stream and no sessions in this server. */
export function GET() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}
