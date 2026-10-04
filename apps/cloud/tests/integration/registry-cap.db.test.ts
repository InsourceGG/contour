import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloudDb, type CloudDb } from "../../src/server/db";
import { createProject } from "../../src/server/registry";

describe.skipIf(process.env.CLOUD_DB_TESTS !== "1")("owner project cap against the real cloud schema", () => {
  const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let owner: string | undefined;
  let db: CloudDb;
  const input = { name: "Cap test fixture", company: "Test", description: "", base_url: "https://cap-test.invalid", surfaces: ["overview"] };

  beforeAll(async () => {
    const result = await admin().auth.admin.createUser({ email: `cloud-cap-${randomUUID()}@example.com`, email_confirm: true });
    if (result.error || !result.data.user) throw new Error("Unable to create isolated owner fixture");
    owner = result.data.user.id;
    db = cloudDb();
    for (let i = 0; i < 4; i++) await createProject(db, owner, input);
  }, 20_000);

  afterAll(async () => {
    if (!owner) return;
    const removed = await db.from("projects").delete().eq("owner_id", owner);
    if (removed.error) throw new Error("Unable to remove cap test projects");
    if ((await admin().auth.admin.deleteUser(owner)).error) throw new Error("Unable to remove isolated owner fixture");
  }, 20_000);

  it("allows only one of two concurrent fifth-project requests", async () => {
    const results = await Promise.allSettled([createProject(db, owner!, input), createProject(db, owner!, input)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("You can register up to 5 projects.");
    const rows = await db.from("projects").select("id").eq("owner_id", owner);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(5);
  });

  it("rejects a direct sixth insert in the database", async () => {
    const result = await db.from("projects").insert({ ...input, owner_id: owner, verify_nonce: randomUUID() });
    expect(result.error).toMatchObject({ code: "23514", message: "PROJECT_LIMIT_REACHED" });
    const rows = await db.from("projects").select("id").eq("owner_id", owner);
    expect(rows.data).toHaveLength(5);
  });
});
