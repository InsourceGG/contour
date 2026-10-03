import { getBroker } from "@/server/broker";
import { contour } from "@/server/contour";

/** In-app adaptation request: same broker path as the agent's propose_view. */
export async function POST(request: Request) {
  return contour.hostMutation(request, (ctx, body) => getBroker().proposeView(ctx, body));
}
