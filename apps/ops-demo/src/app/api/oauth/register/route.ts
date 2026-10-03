import { corsPreflight } from "@contour/sdk/server";
import { contour } from "@/server/contour";

/** RFC 7591 Dynamic Client Registration (public clients only). */
export async function POST(request: Request) {
  return contour.oauth.register(request);
}

export function OPTIONS() {
  return corsPreflight();
}
