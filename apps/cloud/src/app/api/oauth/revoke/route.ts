import { corsPreflight } from "@contour/sdk/server";
import { contour } from "@/server/contour";
export async function POST(request: Request) { return contour.oauth.revoke(request); }
export function OPTIONS() { return corsPreflight(); }
