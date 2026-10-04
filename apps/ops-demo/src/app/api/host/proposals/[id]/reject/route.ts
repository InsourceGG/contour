import { getBroker } from "@/server/broker";
import { contour } from "@/server/contour";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return contour.hostMutation(request, (vc) => getBroker().rejectProposal(vc, id));
}
