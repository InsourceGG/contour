import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../../src/app/owner/create/route";
import { createFakeDb } from "../helpers/fake-db";

const mocks = vi.hoisted(() => ({ form: vi.fn(), db: vi.fn() }));
vi.mock("../../src/server/forms", async (original) => ({
  ...await original<typeof import("../../src/server/forms")>(), authenticatedForm: mocks.form,
}));
vi.mock("../../src/server/db", () => ({ cloudDb: mocks.db }));
vi.mock("../../src/server/contour", () => ({ contour: {} }));
vi.mock("../../src/server/context", () => ({ resolveHostUser: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("APP_URL", "https://cloud.example"); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
function fixture(owner: string, projects: Record<string, unknown>[] = []) {
  const db = createFakeDb({ projects }); mocks.db.mockReturnValue(db);
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: "Operations", company: "Company", description: "", base_url: "https://app.example.com", surfaces: "overview" })) form.set(key, value);
  mocks.form.mockResolvedValue({ user: { subjectId: owner }, form });
  return db;
}
function request() { return new Request("https://cloud.example/owner/create", { method: "POST" }); }

it("creates a fifth project without counting another owner's projects", async () => {
  const db = fixture("fifth-owner", [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `mine-${i}`, owner_id: "fifth-owner" })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `other-${i}`, owner_id: "other" })),
  ]);
  const response = await POST(request());
  expect(new URL(response.headers.get("location")!).searchParams.has("created")).toBe(true);
  expect(db.tables.get("projects")!.filter(p => p.owner_id === "fifth-owner")).toHaveLength(5);
});

it("reports the five-project cap without adding a sixth project or audit event", async () => {
  const db = fixture("capped-owner", Array.from({ length: 5 }, (_, i) => ({ id: `mine-${i}`, owner_id: "capped-owner" })));
  expect((await POST(request())).headers.get("location")).toBe("https://cloud.example/owner?error=limit");
  expect(db.tables.get("projects")).toHaveLength(5);
  expect(db.tables.get("audit_events") ?? []).toHaveLength(0);
});

it("rate-limits creation attempts even if the project cap rejects them", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2040-01-01"));
  fixture("rate-owner", Array.from({ length: 5 }, (_, i) => ({ id: `mine-${i}`, owner_id: "rate-owner" })));
  for (let i = 0; i < 5; i++) await POST(request());
  expect((await POST(request())).headers.get("location")).toBe("https://cloud.example/owner?error=rate");
  fixture("independent-owner");
  expect(new URL((await POST(request())).headers.get("location")!).searchParams.has("created")).toBe(true);
});
