import { getBroker } from "@/server/broker";
import { hostMutation } from "@/server/host-route";

export async function POST(request: Request) {
  return hostMutation(request, (ctx, body) => getBroker().undo(ctx, body));
}
