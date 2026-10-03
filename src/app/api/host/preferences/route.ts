import { getBroker } from "@/server/broker";
import { hostMutation } from "@/server/host-route";

export async function PUT(request: Request) {
  return hostMutation(request, (ctx, body) => getBroker().updatePreferences(ctx, body));
}
