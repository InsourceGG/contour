import { NO_STORE_HEADERS } from "@/server/oauth/config";
import { OAuthError, oauthErrorResponse } from "@/server/oauth/errors";
import { corsPreflight, PUBLIC_CORS_HEADERS, readFormBody } from "@/server/oauth/http";
import { allowRequest, clientIp } from "@/server/oauth/ratelimit";
import { revokePresentedToken } from "@/server/oauth/tokens";

/** RFC 7009 token revocation. Always 200 for well-formed requests (§2.2). */
export async function POST(request: Request) {
  try {
    if (!(await allowRequest("revoke", clientIp(request), 60, 60))) {
      throw new OAuthError("temporarily_unavailable", "Too many requests; retry shortly", 429);
    }
    const params = await readFormBody(request);
    const tokens = params.getAll("token");
    if (tokens.length !== 1 || !tokens[0]) throw new OAuthError("invalid_request", "token is required exactly once");
    const clientIds = params.getAll("client_id");
    if (clientIds.length > 1) throw new OAuthError("invalid_request", "Duplicate client_id parameter");
    await revokePresentedToken(tokens[0], clientIds[0] || undefined);
    return new Response(null, { status: 200, headers: { ...NO_STORE_HEADERS, ...PUBLIC_CORS_HEADERS } });
  } catch (e) {
    return oauthErrorResponse(e, PUBLIC_CORS_HEADERS);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
