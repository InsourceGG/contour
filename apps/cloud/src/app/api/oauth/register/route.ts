import { corsPreflight } from "@contour/sdk/server";
import { contour } from "@/server/contour";
export async function POST(request: Request) { return contour.oauth.register(request); }
export function OPTIONS() { return corsPreflight(); }
