import { corsPreflight } from "@contour/sdk/server";
import { contour } from "@/server/contour";

/** RFC 7009 token revocation. Always 200 for well-formed requests (§2.2). */
export async function POST(request: Request) {
  return contour.oauth.revoke(request);
}

export function OPTIONS() {
  return corsPreflight();
}
