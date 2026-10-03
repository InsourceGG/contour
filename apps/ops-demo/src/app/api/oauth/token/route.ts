import { NO_STORE_HEADERS } from "@/server/oauth/config";
import { OAuthError, oauthErrorResponse } from "@/server/oauth/errors";
import { corsPreflight, PUBLIC_CORS_HEADERS, publicClientId, readFormBody } from "@/server/oauth/http";
import { allowRequest, clientIp } from "@/server/oauth/ratelimit";
import { exchangeAuthorizationCode, refreshAccessToken } from "@/server/oauth/tokens";

/** OAuth 2.1 token endpoint: authorization_code (+PKCE S256) and refresh_token (rotating). */
export async function POST(request: Request) {
  try {
    if (!(await allowRequest("token", clientIp(request), 60, 60))) {
      throw new OAuthError("temporarily_unavailable", "Too many token requests; retry shortly", 429);
    }
    const params = await readFormBody(request);
    const grantTypes = params.getAll("grant_type");
    if (grantTypes.length !== 1) throw new OAuthError("invalid_request", "grant_type is required exactly once");
    const clientId = publicClientId(request, params);
    let body;
    if (grantTypes[0] === "authorization_code") body = await exchangeAuthorizationCode(params, clientId);
    else if (grantTypes[0] === "refresh_token") body = await refreshAccessToken(params, clientId);
    else throw new OAuthError("unsupported_grant_type", "Supported grant types: authorization_code, refresh_token");
    return Response.json(body, { headers: { ...NO_STORE_HEADERS, ...PUBLIC_CORS_HEADERS } });
  } catch (e) {
    return oauthErrorResponse(e, PUBLIC_CORS_HEADERS);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
