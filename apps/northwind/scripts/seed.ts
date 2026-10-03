import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { hashPassword } from "../src/lib/auth";
try { loadEnvFile(".env.local"); } catch { /* Environment may be supplied by the caller. */ }
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Missing Northwind database configuration.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).schema("northwind");
const uid = (group: number, n: number) => `${group.toString().padStart(8, "0")}-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const now = new Date();
const iso = (minutes: number) => new Date(now.getTime() + minutes * 60000).toISOString();
async function upsert(table: string, data: object[], onConflict = "id") {
  const { error } = await db.from(table).upsert(data, { onConflict });
  if (error) throw new Error(`Seed failed for ${table}: ${error.message}`);
}
async function main() {
  await upsert("teams", [
    { id: uid(1, 1), name: "Tier 1", description: "Account access, orders, billing, and first-response support." },
    { id: uid(1, 2), name: "Tier 2", description: "Technical escalations, API issues, and complex account recovery." },
  ]);
  const users = [
    { id: uid(2, 1), email: "riley@northwind.demo", name: "Riley Chen", role: "agent", team: "Tier 1", capacity: 12 },
    { id: uid(2, 2), email: "casey@northwind.demo", name: "Casey Morgan", role: "lead", team: "Tier 2", capacity: 16 },
    { id: uid(2, 3), email: "dana@northwind.demo", name: "Dana Brooks", role: "admin", team: "Tier 1", capacity: 10 },
  ];
  await upsert("users", await Promise.all(users.map(async user => ({ ...user, password_hash: await hashPassword("northwind-demo-2026") }))));
  // Preserve preferences when reseeding an existing desk.
  const { error: settingsError } = await db.from("user_settings").upsert(users.map(user => ({ user_id: user.id, display_name: user.name, email_notifications: true, sla_notifications: true, daily_digest: false })), { onConflict: "user_id", ignoreDuplicates: true });
  if (settingsError) throw new Error("Could not seed user settings.");
  const customerNames = ["Avery Johnson", "Morgan Ellis", "Jamie Rivera", "Taylor Reed", "Samira Patel", "Elliot Park", "Harper Lewis", "Quinn Foster", "Robin Hayes", "Alex Monroe", "Jordan Price", "Cameron Bell"];
  const companies = ["Harbor & Field", "Bramble Studio", "Juniper Supply", "Atlas Workshop", "Fernwood Foods", "Copperline", "Morrow Goods", "Pine & Parcel", "Cedar House", "Meridian Labs", "Westhaven", "Tandem Works"];
  const customers = customerNames.map((name, i) => ({ id: uid(3, i + 1), name, company: companies[i], email: `contact${i + 1}@customer.example`, plan: i % 3 === 0 ? "Enterprise" : "Business", team: i < 6 ? "Tier 1" : "Tier 2", created_at: iso(-1440 * (80 + i)) }));
  await upsert("customers", customers);
  const subjects = [
    "Invoice total does not match the order", "Unable to reset account password", "Order arrived with a missing item", "Update billing contact for our account", "Refund status for a returned order", "Change delivery address before dispatch", "Export is missing recent transactions", "Duplicate charge on monthly invoice", "Invite a new teammate to our workspace", "Tracking link has not updated", "Account locked after sign-in attempts", "Need a copy of our tax invoice", "Subscription renewal date is incorrect", "Discount code did not apply", "Remove an inactive workspace member", "Receipt email sent to the wrong address", "Confirm availability for a large order", "Request a replacement for damaged goods", "Plan change has not taken effect", "Shipment was delivered to the wrong location",
    "API requests returning intermittent 502 errors", "Webhook delivery delayed for order updates", "SSO sign-in fails for our domain", "Inventory sync stopped overnight", "Custom export times out on large accounts", "Unexpected API rate-limit response", "Payment callback signature mismatch", "Audit log entries are missing", "Order import duplicates line items", "Dashboard permissions differ from API access", "Mobile session expires too early", "Data reconciliation mismatch after sync", "Search results omit archived orders", "Recover a deleted workspace", "API pagination repeats the last record", "Timezone offset in reporting export", "Integration token rotation failed", "Attachment uploads stop at 80 percent", "Reconcile partial shipment events", "Scheduled report did not arrive",
  ];
  const tickets = subjects.map((subject, i) => {
    const team = i < 20 ? "Tier 1" : "Tier 2";
    const customer = customers[(i < 20 ? 0 : 6) + i % 6];
    const status = i % 7 === 6 ? "resolved" : i % 4 === 2 ? "pending" : "open";
    const dueMinutes = status === "resolved" ? 180 : i % 10 < 2 ? -(25 + i * 3) : 45 + (i % 10) * 28;
    return { id: uid(4, i + 1), number: 2401 + i, subject, description: `${customer.name} from ${customer.company} contacted Northwind about this issue. They need a clear next step and an estimated resolution time. Review the account history before sending a reply.`, status, priority: i % 10 < 2 ? "urgent" : i % 3 === 0 ? "high" : i % 5 === 0 ? "low" : "normal", team, customer_id: customer.id, assignee_id: i % 3 === 0 ? null : team === "Tier 1" ? i % 5 === 0 ? uid(2, 3) : uid(2, 1) : uid(2, 2), channel: ["email", "chat", "phone"][i % 3], due_at: iso(dueMinutes), created_at: iso(-(80 + i * 49)), updated_at: iso(-(8 + i * 7)) };
  });
  await upsert("tickets", tickets);
  await upsert("sla_timers", tickets.map(ticket => ({ ticket_id: ticket.id, team: ticket.team, due_at: ticket.due_at })), "ticket_id");
  const csat = Array.from({ length: 60 }, (_, i) => ["Tier 1", "Tier 2"].map((team, t) => ({ team, date: iso(-(59 - i) * 1440).slice(0, 10), score: Math.min(98, 86 + (i % 7) + t * 2 + Math.floor(i / 15)), responses: 8 + (i * 3 + t) % 14 }))).flat();
  await upsert("csat_scores", csat, "team,date");
  const articles = [
    ["Handle a billing discrepancy", "Compare the invoice, line items, and account credits before issuing an adjustment.", "Billing"],
    ["Guide a customer through account recovery", "Verify account ownership and send a secure reset link.", "Account access"],
    ["Arrange a replacement shipment", "Check delivery evidence, stock availability, and the customer's preferred address.", "Orders"],
    ["Explain refund processing times", "Set a clear expectation based on the payment method and return status.", "Billing"],
    ["Resolve workspace invitation issues", "Check the recipient address, invitation status, and workspace permissions.", "Account access"],
    ["Update an order before dispatch", "Confirm the fulfillment stage before changing delivery details.", "Orders"],
    ["Investigate failed webhook deliveries", "Review delivery logs and retry windows before escalating.", "Integrations"],
    ["Diagnose SSO sign-in failures", "Check domain verification, identity claims, and certificate expiry.", "Account access"],
    ["Troubleshoot inventory synchronization", "Compare recent sync timestamps and reconcile failed records.", "Integrations"],
    ["Review API rate-limit responses", "Identify the affected endpoint and confirm the retry strategy.", "API"],
    ["Recover a workspace safely", "Verify the retention window and the owner's approval before recovery.", "Account access"],
    ["Resolve reporting timezone differences", "Check the workspace timezone and export date boundaries.", "Reporting"],
  ];
  await upsert("kb_articles", articles.map(([title, summary, topic], i) => ({ id: uid(6, i + 1), title, summary, topic, team: i < 6 ? "Tier 1" : "Tier 2", read_minutes: 3 + i % 4, updated_at: iso(-(i + 1) * 1440), body: `${summary}\n\n1. Confirm the customer's account and the ticket details.\n2. Review recent activity and collect the relevant evidence.\n3. Explain what you found in plain language and agree on the next step.\n4. Record the outcome in the ticket. Escalate to your team lead if the issue remains unresolved.` })));
  await upsert("customer_events", [...tickets.slice(0, 12), ...tickets.slice(20, 32)].map((ticket, i) => ({ id: uid(7, i + 1), customer_id: ticket.customer_id, ticket_id: ticket.id, team: ticket.team, kind: ["opened", "reply", "note", "resolved"][i % 4], description: ["Opened a new support request.", "Shared additional details with the support team.", "Account history reviewed and next steps recorded.", "Confirmed that the issue is resolved."][i % 4], created_at: iso(-(i * 19 + 3)) })));
  console.log("Northwind seeded: 3 users, 2 teams, 12 customers, 40 tickets, 120 daily CSAT summaries, 12 articles, and 24 customer events.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Northwind seed failed."); process.exitCode = 1; });
