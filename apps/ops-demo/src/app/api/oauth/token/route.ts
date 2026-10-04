import { corsPreflight } from "@contour/sdk/server";
import { contour } from "@/server/contour";

/** OAuth 2.1 token endpoint: authorization_code (+PKCE S256) and refresh_token (rotating). */
export async function POST(request: Request) {
  return contour.oauth.token(request);
}

export function OPTIONS() {
  return corsPreflight();
}
