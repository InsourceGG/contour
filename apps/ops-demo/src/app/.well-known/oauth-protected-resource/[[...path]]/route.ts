import { protectedResourceMetadata } from "@/server/oauth/config";
import { corsPreflight, PUBLIC_CORS_HEADERS } from "@/server/oauth/http";

/**
 * RFC 9728 Protected Resource Metadata for the MCP endpoint. Served at the
 * path-inserted URL (/.well-known/oauth-protected-resource/api/mcp, the one
 * advertised in WWW-Authenticate) and at the root, which MCP clients try next.
 */
export async function GET(_req: Request, ctx: RouteContext<"/.well-known/oauth-protected-resource/[[...path]]">) {
  const { path } = await ctx.params;
  const suffix = path && path.length > 0 ? `/${path.join("/")}` : "";
  if (suffix !== "" && suffix !== "/api/mcp") {
    return Response.json({ error: "not_found" }, { status: 404, headers: PUBLIC_CORS_HEADERS });
  }
  return Response.json(protectedResourceMetadata(), {
    headers: { ...PUBLIC_CORS_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}

export function OPTIONS() {
  return corsPreflight();
}
