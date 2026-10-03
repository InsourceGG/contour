import { getBroker } from "@/server/broker";
import { hostMutation } from "@/server/host-route";

/** In-app adaptation request: same broker path as the agent's propose_view. */
export async function POST(request: Request) {
  return hostMutation(request, (ctx, body) => getBroker().proposeView(ctx, body));
}
