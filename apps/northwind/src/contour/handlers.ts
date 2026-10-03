import "server-only";
import { createContourHandlers, type ContourRouteHandler } from "@contour/sdk/server";
import { getBroker } from "./broker";
import { projectReceipt } from "./project";
import { contour } from "./server";

let table: Record<string, ContourRouteHandler> | undefined;

/** Maps the catch-all segments onto the SDK's canonical route keys. */
export async function dispatch(req: Request, ctx: { params: Promise<{ contour: string[] }> }): Promise<Response> {
  // Without a registration receipt the project document stays 404.
  const receipt = projectReceipt();
  table ??= createContourHandlers(contour, { broker: getBroker(), projectId: receipt?.projectId, wellKnownNonce: receipt?.nonce });
  const { contour: segments } = await ctx.params;
  let route = `/${segments.join("/")}`;
  const params: Record<string, string | string[]> = {};
  const prm = "/.well-known/oauth-protected-resource";
  const as = "/.well-known/oauth-authorization-server";
  if (route === prm || route.startsWith(`${prm}/`)) {
    params.path = segments.slice(2); route = prm;
  } else if (route === as || route.startsWith(`${as}/`)) {
    params.path = segments.slice(2); route = as;
  } else {
    const proposal = route.match(/^\/api\/host\/proposals\/([^/]+)\/(apply|reject)$/);
    const grant = route.match(/^\/api\/host\/agents\/([^/]+)\/revoke$/);
    if (proposal) { params.id = proposal[1]; route = `/api/host/proposals/[id]/${proposal[2]}`; }
    if (grant) { params.grantId = grant[1]; route = "/api/host/agents/[grantId]/revoke"; }
  }
  const handler = table[`${req.method} ${route}`];
  if (!handler) return Response.json({ error: "not_found" }, { status: 404 });
  return handler(req, { params: Promise.resolve(params) });
}
