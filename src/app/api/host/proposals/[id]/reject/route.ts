import { getBroker } from "@/server/broker";
import { hostMutation } from "@/server/host-route";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return hostMutation(request, (vc) => getBroker().rejectProposal(vc, id));
}
