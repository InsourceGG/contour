import { registerDynamicClient } from "@/server/oauth/clients";
import { NO_STORE_HEADERS } from "@/server/oauth/config";
import { OAuthError, oauthErrorResponse } from "@/server/oauth/errors";
import { corsPreflight, PUBLIC_CORS_HEADERS, readBodyCapped } from "@/server/oauth/http";
import { allowRequest, clientIp } from "@/server/oauth/ratelimit";

const MAX_BODY = 8 * 1024;

/** RFC 7591 Dynamic Client Registration (public clients only). */
export async function POST(request: Request) {
  try {
    if (!(await allowRequest("dcr", clientIp(request), 3600, 60))) {
      throw new OAuthError("temporarily_unavailable", "Too many registrations from this address; retry later", 429);
    }
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      throw new OAuthError("invalid_client_metadata", "Content-Type must be application/json");
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBodyCapped(request, MAX_BODY));
    } catch (e) {
      if (e instanceof OAuthError) throw e;
      throw new OAuthError("invalid_client_metadata", "Body must be valid JSON");
    }
    const registered = await registerDynamicClient(body);
    return Response.json(registered, { status: 201, headers: { ...NO_STORE_HEADERS, ...PUBLIC_CORS_HEADERS } });
  } catch (e) {
    return oauthErrorResponse(e, PUBLIC_CORS_HEADERS);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
