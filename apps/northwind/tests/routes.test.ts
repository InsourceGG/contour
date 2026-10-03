import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/data/types";
const { getSession, assignTicket } = vi.hoisted(() => ({ getSession: vi.fn(), assignTicket: vi.fn() }));
vi.mock("../src/lib/session", () => ({ getSession }));
vi.mock("../src/data/tickets", () => ({ assignTicket }));
import { POST } from "../src/app/api/tickets/[id]/assign/route";
const session: Session = { userId: "riley", email: "riley@northwind.demo", name: "Riley Chen", role: "agent", team: "Tier 1" };
const id = "00000004-0000-4000-8000-000000000001";
const request = (origin = "http://localhost:3200") => new Request(`http://localhost:3200/api/tickets/${id}/assign`, { method: "POST", headers: { origin, accept: "application/json" } });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_URL", "http://localhost:3200"); getSession.mockResolvedValue(session); assignTicket.mockResolvedValue(undefined); });
describe("assign action endpoint", () => {
  it("rejects unauthenticated assignments without invoking the data mutation", async () => {
    getSession.mockResolvedValue(null);
    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(401);
    expect(assignTicket).not.toHaveBeenCalled();
  });
  it("passes the server-verified identity to a successful assignment", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(assignTicket).toHaveBeenCalledExactlyOnceWith(session, id);
    expect(await response.json()).toEqual({ message: "Ticket assigned to you." });
  });
  it("returns a concealed 404 when the data layer denies a foreign-team ticket", async () => {
    assignTicket.mockRejectedValue(new Error("Ticket not found."));
    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Ticket not found in your team." });
  });
  it("rejects cross-origin submissions before checking the account or changing data", async () => {
    const response = await POST(request("https://foreign.example"), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
    expect(assignTicket).not.toHaveBeenCalled();
  });
  it("rejects malformed identifiers before calling the database", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: "not-a-ticket" }) });
    expect(response.status).toBe(404);
    expect(assignTicket).not.toHaveBeenCalled();
  });
});
