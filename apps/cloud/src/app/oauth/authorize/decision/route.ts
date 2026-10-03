import { contour } from "@/server/contour";
export async function POST(request: Request) { return contour.oauth.decision(request); }
