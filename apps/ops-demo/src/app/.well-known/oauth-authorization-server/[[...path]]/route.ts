import { corsPreflight, PUBLIC_CORS_HEADERS } from "@contour/sdk/server";
import { contour } from "@/server/contour";

/**
 * RFC 8414 Authorization Server Metadata. The issuer has no path component,
 * so the canonical URL is the root; /api/mcp is also answered for clients
 * that (incorrectly) probe with the resource path. We are not an OpenID
 * Provider, so /.well-known/openid-configuration is intentionally absent.
 */
export async function GET(_req: Request, ctx: RouteContext<"/.well-known/oauth-authorization-server/[[...path]]">) {
  const { path } = await ctx.params;
  const suffix = path && path.length > 0 ? `/${path.join("/")}` : "";
  if (suffix !== "" && suffix !== "/api/mcp") {
    return Response.json({ error: "not_found" }, { status: 404, headers: PUBLIC_CORS_HEADERS });
  }
  return Response.json(contour.oauth.authorizationServerMetadata(), {
    headers: { ...PUBLIC_CORS_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}

export function OPTIONS() {
  return corsPreflight();
}
