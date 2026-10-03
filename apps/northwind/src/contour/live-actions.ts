"use server";

import { getSession } from "@/lib/session";
import { getBroker } from "./broker";
import type { DeskHostData } from "./components";
import { contour } from "./server";
import { loadDeskData } from "./surface-data";

/**
 * Host data for a pending live proposal, so its preview renders real rows.
 * The proposal is looked up for the verified signed-in user only (another
 * user's ID reads as missing), and the data comes from the same team-scoped
 * loaders as the desk itself. Reading never applies or saves anything.
 */
export async function loadProposalDeskData(proposalId: string): Promise<Partial<DeskHostData> | null> {
  if (typeof proposalId !== "string" || !/^[0-9a-f-]{36}$/i.test(proposalId)) return null;
  const session = await getSession();
  if (!session) return null;
  try {
    const user = await contour.requireUser();
    const preview = await getBroker().getPreview(contour.contextFromUser(user), proposalId);
    if (preview.state !== "ready") return null;
    return await loadDeskData(session, preview.proposed);
  } catch {
    // Missing, foreign, or invalid proposals render with the desk's current data.
    return null;
  }
}
