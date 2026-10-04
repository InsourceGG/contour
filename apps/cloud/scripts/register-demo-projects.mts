/**
 * Registers (and, with --verify, verifies) the two demo companies as projects
 * in Contour Cloud, owned by the demo site owner morgan@contour.demo.
 *
 *   pnpm tsx --conditions react-server apps/cloud/scripts/register-demo-projects.mts            # create, print ids + nonces
 *   pnpm tsx --conditions react-server apps/cloud/scripts/register-demo-projects.mts --verify   # verify after the apps serve their receipts
 *
 * Each company serves /.well-known/contour-project.json from the env vars
 * CONTOUR_PROJECT_ID and CONTOUR_PROJECT_NONCE; this script prints them.
 */
process.loadEnvFile(new URL("../.env.local", import.meta.url));
process.env.NODE_ENV = "production"; // never allow local projects here

const { createClient } = await import("@supabase/supabase-js");
const { createProject, verifyOwnedProject } = await import("../src/server/registry.ts");

const OWNER_EMAIL = "morgan@contour.demo";
const PROJECTS = [
  {
    name: "Operations overview",
    company: "Acme",
    description: "Daily operations dashboard: revenue, metrics, tasks and alerts.",
    base_url: "https://contour-acme.vercel.app",
    surfaces: ["overview"],
  },
  {
    name: "Support desk",
    company: "Northwind",
    description: "Ticket queue, SLA alerts, satisfaction and knowledge base.",
    base_url: "https://northwind-support-app.vercel.app",
    surfaces: ["desk"],
  },
];

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const db = supa.schema("cloud");
const users = await supa.auth.admin.listUsers({ page: 1, perPage: 200 });
const owner = users.data.users.find((u) => u.email === OWNER_EMAIL);
if (!owner) throw new Error(`${OWNER_EMAIL} not found; run the ops-demo seed`);

for (const p of PROJECTS) {
  const existing = await db.from("projects").select("id,verify_nonce,status").eq("owner_id", owner.id).eq("base_url", p.base_url).maybeSingle();
  let id = existing.data?.id as string | undefined;
  if (!id) id = await createProject(db, owner.id, p);
  const row = await db.from("projects").select("id,verify_nonce,status").eq("id", id).single();
  if (process.argv.includes("--verify") && row.data!.status !== "verified") {
    await verifyOwnedProject(db, owner.id, id);
  }
  const after = await db.from("projects").select("status,mcp_resource").eq("id", id).single();
  console.log(JSON.stringify({ company: p.company, base_url: p.base_url, CONTOUR_PROJECT_ID: id, CONTOUR_PROJECT_NONCE: row.data!.verify_nonce, status: after.data!.status, mcp_resource: after.data!.mcp_resource }));
}
