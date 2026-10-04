import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ContourError, type VerifiedContext } from "@contour/sdk/core";
import { admin, brokerWith, ctxFor, fixedSelector, grantFixtureCredit, proposeReq, resetSubject, userSession } from "../support/fixtures";

let alex: VerifiedContext;
let agent: VerifiedContext;

beforeAll(async () => {
  alex = await ctxFor("alex@contour.demo");
  agent = await ctxFor("alex@contour.demo", { channel: "mcp" });
  await admin().from("apps").update({ agent_access_enabled: true }).eq("id", "ops-demo");
  await admin().from("tenant_app_settings").upsert({ tenant_id: "acme", app_id: "ops-demo", agent_access_enabled: true });
});

beforeEach(async () => {
  await resetSubject(alex.subjectId);
  const { error } = await admin().from("contour_jobs").delete().eq("subject_id", alex.subjectId);
  if (error) throw error;
});

describe("live host proposal presentation", () => {
  it("exposes working and ready agent progress, then clears the pending proposal after host Accept", async () => {
    const selector = fixedSelector("guided");
    let finish!: () => void;
    let entered!: () => void;
    const selecting = new Promise<void>((resolve) => { entered = resolve; });
    const release = new Promise<void>((resolve) => { finish = resolve; });
    const broker = brokerWith({
      ...selector,
      async select(input) {
        entered();
        await release;
        return selector.select(input);
      },
    });
    await grantFixtureCredit(alex);
    const request = broker.proposeView(agent, proposeReq(0));
    await Promise.race([selecting, request]);
    try {
      const working = await broker.getLive(alex);
      expect(working.job?.status).toBe("working");
      expect(working.proposal).toBeNull();
      expect(working.revision).toBe(0);
    } finally {
      finish();
    }
    const result = await request;
    expect(result.outcome).toBe("READY");
    if (result.outcome !== "READY") throw new Error("Expected a READY fixture proposal");
    const { data: job, error } = await admin().from("contour_jobs").select("status,proposal_id,client_id").eq("subject_id", alex.subjectId).single();
    if (error) throw error;
    expect(job).toMatchObject({ status: "ready", proposal_id: result.proposalId, client_id: agent.clientId });

    const live = await broker.getLive(alex);
    expect(live.proposal?.state).toBe("ready");
    expect(live.proposal?.proposal.id).toBe(result.proposalId);
    expect(live.job?.changedComponents.length).toBeGreaterThan(0);
    await expect(broker.getLive(agent)).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<ContourError>);
    await broker.applyProposal(alex, {
      proposalId: result.proposalId,
      configHash: live.proposal!.proposal.configHash,
      idempotencyKey: `live-accept-${randomUUID()}`,
    });
    const after = await broker.getLive(alex);
    expect(after.revision).toBe(1);
    expect(after.proposal).toBeNull();
    expect(after.configHash).toBe(live.proposal!.proposal.configHash);
  });

  it("keeps job rows service-only even for the authenticated owner", async () => {
    const session = await userSession("alex@contour.demo");
    const { data, error } = await session.from("contour_jobs").select("id").eq("subject_id", alex.subjectId);
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe("42501");
  });
});
