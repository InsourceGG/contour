import { contourProjectResponse } from "@contour/sdk/server";
import { contour } from "@/server/contour";

export const dynamic = "force-dynamic";

export function GET() {
  return contourProjectResponse(contour, {
    projectId: process.env.CONTOUR_PROJECT_ID,
    nonce: process.env.CONTOUR_PROJECT_NONCE,
  });
}
