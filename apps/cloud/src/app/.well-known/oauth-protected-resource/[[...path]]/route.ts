import { corsPreflight, PUBLIC_CORS_HEADERS } from "@contour/sdk/server";
import { contour } from "@/server/contour";
export async function GET(_request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const suffix = path?.length ? `/${path.join("/")}` : "";
  if (suffix !== "" && suffix !== "/api/mcp") return Response.json({ error: "not_found" }, { status: 404, headers: PUBLIC_CORS_HEADERS });
  return Response.json(contour.oauth.protectedResourceMetadata(), {
    headers: { ...PUBLIC_CORS_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}
export function OPTIONS() { return corsPreflight(); }
