import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import Projects from "../../src/app/projects/page";
import LinkStart from "../../src/app/link/start/page";
import { createFakeDb } from "../helpers/fake-db";

const mocks = vi.hoisted(() => ({ db: vi.fn(), user: vi.fn() }));
vi.mock("../../src/server/db", () => ({ cloudDb: mocks.db }));
vi.mock("../../src/server/context", () => ({ resolveHostUser: mocks.user }));
vi.mock("../../src/server/page-auth", () => ({ pageUser: mocks.user }));
vi.mock("../../src/server/contour", () => ({ contour: { oauth: { csrfTokenFor: () => "csrf", listGrantsForUser: async () => [] } } }));

const project = {
  id: "11111111-1111-4111-8111-111111111111", name: "Owner project name", company: "Owner company name",
  description: "Description", status: "verified", base_url: "https://app.example.com/tenant",
  mcp_resource: "https://app.example.com/api/mcp", as_issuer: "https://app.example.com",
  token_endpoint: "https://app.example.com/token", authorization_endpoint: "https://app.example.com/authorize",
};
beforeEach(() => {
  mocks.db.mockReturnValue(createFakeDb({ projects: [project], links: [] }));
  mocks.user.mockResolvedValue({ subjectId: "consumer", email: "consumer@example.com" });
});
it.each(["projects", "link/start"])("discloses the verified sign-in host and owner-provided names on /%s", async (page) => {
  const tree = page === "projects" ? await Projects({ searchParams: Promise.resolve({}) }) :
    await LinkStart({ searchParams: Promise.resolve({ project: project.id }) });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("You will sign in at <strong>app.example.com</strong>");
  expect(html).toContain("Names provided by the project owner");
  expect(html).toContain(project.name);
  expect(html).toContain(project.company);
  expect(html).not.toContain("\u2014");
});
