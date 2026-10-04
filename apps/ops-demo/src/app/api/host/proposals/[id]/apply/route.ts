import { getBroker } from "@/server/broker";
import { contour } from "@/server/contour";

/** Accept: authenticated, CSRF-protected approval that applies the STORED
 *  proposal atomically. The body can only reference it, never replace it. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return contour.hostMutation(request, (vc, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    return getBroker().applyProposal(vc, { proposalId: id, configHash: b.configHash, idempotencyKey: b.idempotencyKey });
  });
}
