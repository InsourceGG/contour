import { getBroker } from "@/server/broker";
import { contour } from "@/server/contour";

export async function POST(request: Request) {
  return contour.hostMutation(request, (ctx, body) => getBroker().reset(ctx, body));
}
