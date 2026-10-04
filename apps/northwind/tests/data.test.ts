import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/data/types";
const { rows, writes } = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, writes: [] as { table: string; value: unknown }[] }));
vi.mock("../src/lib/db", () => ({ getDb: () => ({ from: (table: string) => {
  let items = [...(rows[table] ?? [])];
  let update: unknown;
  const valueAt = (item: Record<string, unknown>, path: string): unknown => path.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, item);
  const chain = {
    select: () => chain,
    eq: (key: string, value: unknown) => { items = items.filter(item => valueAt(item, key) === value); return chain; },
    neq: (key: string, value: unknown) => { items = items.filter(item => valueAt(item, key) !== value); return chain; },
    in: (key: string, value: unknown[]) => { items = items.filter(item => value.includes(item[key])); return chain; },
    gte: (key: string, value: string) => { items = items.filter(item => String(valueAt(item, key)) >= value); return chain; }, lt: (key: string, value: string) => { items = items.filter(item => String(valueAt(item, key)) < value); return chain; }, order: () => chain, limit: (limit: number) => { items = items.slice(0, limit); return chain; },
    returns: () => chain,
    update: (value: unknown) => { update = value; return chain; },
    insert: (value: unknown) => { writes.push({ table, value }); return chain; },
    maybeSingle: async () => ({ data: items[0] ?? null, error: null }),
    single: async () => ({ data: items[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => { if (update && items.length) writes.push({ table, value: update }); return Promise.resolve(resolve({ data: items, error: null })); },
  }; return chain;
} }) }));
import { getTickets, getTicketReplies, assignTicket, replyToTicket } from "../src/data/tickets";
import { getSlaBreaches } from "../src/data/sla";
import { getCsatTrend } from "../src/data/csat";
import { getWorkload } from "../src/data/workload";
import { getKbArticles } from "../src/data/kb";
import { getCustomerTimeline } from "../src/data/timeline";
import { getCustomers, getCustomer } from "../src/data/customers";
import { getTeams } from "../src/data/teams";
const agent: Session = { userId: "riley", email: "riley@northwind.demo", name: "Riley Chen", role: "agent", team: "Tier 1" };
const admin: Session = { ...agent, userId: "dana", role: "admin" };
const lead: Session = { ...agent, role: "lead" };
beforeEach(() => {
  writes.length = 0;
  const ticket = (id: string, team: string) => ({ id, team, number: Number(id), subject: `Issue ${id}`, status: "open", priority: "high", assignee_id: null, due_at: new Date(Date.now() - 3600000).toISOString(), customer: { name: "Customer", company: "Company" } });
  rows.tickets = [ticket("1", "Tier 1"), ticket("2", "Tier 2")];
  rows.sla_timers = rows.tickets.map(ticket => ({ team: ticket.team, due_at: ticket.due_at, ticket_id: ticket.id, ticket }));
  rows.csat_scores = [{ team: "Tier 1", date: new Date().toISOString().slice(0, 10), score: 90, responses: 10 }, { team: "Tier 2", date: new Date().toISOString().slice(0, 10), score: 60, responses: 10 }];
  rows.users = [{ id: "riley", name: "Riley", team: "Tier 1", capacity: 12 }, { id: "casey", name: "Casey", team: "Tier 2", capacity: 12 }];
  rows.kb_articles = [{ id: "kb1", team: "Tier 1", title: "Tier 1 guide" }, { id: "kb2", team: "Tier 2", title: "Tier 2 guide" }];
  rows.customers = [{ id: "customer1", team: "Tier 1" }, { id: "customer2", team: "Tier 2" }];
  rows.ticket_replies = [{ id: "reply1", ticket_id: "1", team: "Tier 1", body: "Hello", author: { name: "Riley" } }, { id: "reply2", ticket_id: "2", team: "Tier 2", body: "Hello", author: { name: "Casey" } }];
  rows.customer_events = rows.tickets.map(ticket => ({ id: `event${ticket.id}`, team: ticket.team, ticket_id: ticket.id, ticket, customer: ticket.customer }));
});
describe("reader team isolation", () => {
  for (const session of [agent, lead]) {
    it(`${session.role} receives only Tier 1 tickets, SLA, workload, articles, timeline, and CSAT`, async () => {
      expect((await getTickets(session, {})).map(item => item.team)).toEqual(["Tier 1"]);
      expect((await getSlaBreaches(session)).map(item => item.team)).toEqual(["Tier 1"]);
      expect((await getWorkload(session)).map(item => item.team)).toEqual(["Tier 1"]);
      expect((await getKbArticles(session, {})).map(item => item.team)).toEqual(["Tier 1"]);
      expect((await getCustomerTimeline(session, {})).map(item => item.team)).toEqual(["Tier 1"]);
      expect((await getCsatTrend(session, { range: "7d" }))[0].score).toBe(90);
    });
  }
  it("admin sees both teams in every reader", async () => {
    expect(await getTickets(admin, {})).toHaveLength(2);
    expect(await getSlaBreaches(admin)).toHaveLength(2);
    expect(await getWorkload(admin)).toHaveLength(2);
    expect(await getKbArticles(admin, {})).toHaveLength(2);
    expect(await getCustomerTimeline(admin, {})).toHaveLength(2);
    expect((await getCsatTrend(admin, { range: "30d" }))[0].score).toBe(75);
  });
});
describe("query behavior and additional access boundaries", () => {
  it("applies ticket status filters within the agent's team", async () => {
    rows.tickets.push({ ...rows.tickets[0], id: "3", number: 3, status: "pending" });
    expect((await getTickets(agent, { filter: "pending" })).map(ticket => ticket.id)).toEqual(["3"]);
    expect(await getTickets(agent, { filter: "resolved" })).toEqual([]);
  });
  it("counts open and pending work per user with scoped team visibility", async () => {
    rows.tickets[0].assignee_id = "riley";
    rows.tickets[1].assignee_id = "casey";
    rows.tickets.push({ ...rows.tickets[0], id: "3", status: "pending" });
    rows.tickets.push({ ...rows.tickets[0], id: "4", status: "resolved" });
    expect(await getWorkload(agent)).toEqual([{ userId: "riley", name: "Riley", team: "Tier 1", open: 1, pending: 1, capacity: 12 }]);
    expect(await getWorkload(admin)).toEqual([{ userId: "riley", name: "Riley", team: "Tier 1", open: 1, pending: 1, capacity: 12 }, { userId: "casey", name: "Casey", team: "Tier 2", open: 1, pending: 0, capacity: 12 }]);
  });
  it("weights satisfaction by response count across teams", async () => {
    rows.csat_scores[1].responses = 30;
    expect((await getCsatTrend(admin, { range: "7d" }))[0]).toMatchObject({ score: 67.5, responses: 40 });
  });
  it("honors the 7-day and 30-day time windows", async () => {
    const older = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10);
    rows.csat_scores.push({ team: "Tier 1", date: older, score: 70, responses: 10 });
    expect(await getCsatTrend(agent, { range: "7d" })).toHaveLength(1);
    expect(await getCsatTrend(agent, { range: "30d" })).toHaveLength(2);
  });
  it("scopes customer lists, customer detail, and reply histories", async () => {
    expect((await getCustomers(agent, {})).map(customer => customer.team)).toEqual(["Tier 1"]);
    expect(await getCustomer(agent, "customer2")).toBeNull();
    await expect(getTicketReplies(agent, "2")).rejects.toThrow("Ticket not found");
    expect(await getTicketReplies(agent, "1")).toHaveLength(1);
    expect(await getCustomers(admin, {})).toHaveLength(2);
  });
  it("requires an administrator for team management", async () => {
    await expect(getTeams(agent)).rejects.toThrow("Administrator access required");
  });
  it("rejects missing or malformed session identities in all six readers", async () => {
    const invalid = { ...agent, userId: "" };
    for (const reader of [() => getTickets(invalid, {}), () => getSlaBreaches(invalid), () => getCsatTrend(invalid, { range: "7d" }), () => getWorkload(invalid), () => getKbArticles(invalid, {}), () => getCustomerTimeline(invalid, {})]) {
      await expect(reader()).rejects.toThrow("Authentication required");
    }
    await expect(assignTicket(invalid, "1")).rejects.toThrow("Authentication required");
    await expect(replyToTicket(invalid, "1", "Hello")).rejects.toThrow("Authentication required");
    expect(writes).toEqual([]);
  });
});
describe("ticket mutation authorization", () => {
  it("rejects assigning and replying to another team's ticket before writing", async () => {
    await expect(assignTicket(agent, "2")).rejects.toThrow("Ticket not found");
    await expect(replyToTicket(agent, "2", "Your request is being reviewed.")).rejects.toThrow("Ticket not found");
    expect(writes).toEqual([]);
  });
  it("assigns the agent's own ticket", async () => {
    await assignTicket(agent, "1");
    expect(writes.some(write => write.table === "tickets" && (write.value as { assignee_id: string }).assignee_id === "riley")).toBe(true);
  });
  it("admin can assign across teams and a valid reply is persisted", async () => {
    await assignTicket(admin, "2");
    await replyToTicket(agent, "1", "We have received your request.");
    expect(writes.some(write => write.table === "ticket_replies")).toBe(true);
  });
  it("rejects an empty reply", async () => {
    await expect(replyToTicket(agent, "1", " ")).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});
