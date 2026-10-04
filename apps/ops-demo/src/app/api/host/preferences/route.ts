import { getBroker } from "@/server/broker";
import { contour } from "@/server/contour";

export async function PUT(request: Request) {
  return contour.hostMutation(request, (ctx, body) => getBroker().updatePreferences(ctx, body));
}
