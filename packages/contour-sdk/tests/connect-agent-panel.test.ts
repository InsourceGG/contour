import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectAgentPanel } from "../src/react";

const render = (props: Partial<Parameters<typeof ConnectAgentPanel>[0]> = {}) =>
  renderToStaticMarkup(createElement(ConnectAgentPanel, { projectName: "Northwind Orders", mcpUrl: "https://nw.example.test/api/mcp", ...props }));

describe("ConnectAgentPanel", () => {
  it("renders the heading, the plain explanation and the MCP command", () => {
    const html = render();
    expect(html).toContain("Connect your AI agent");
    expect(html).toContain("can never save");
    expect(html).toContain("claude mcp add --transport http northwind-orders https://nw.example.test/api/mcp");
    expect(html).toContain("contour-connect-copy");
    expect(html).not.toContain("—");
    expect(html).not.toContain("Link through Contour Cloud");
  });

  it("adds the Cloud link only when both cloudUrl and projectId are given", () => {
    expect(render({ cloudUrl: "https://cloud.example.test" })).not.toContain("Link through");
    const html = render({ cloudUrl: "https://cloud.example.test/", projectId: "p 1" });
    expect(html).toContain('href="https://cloud.example.test/link/start?project=p%201"');
    expect(html).toContain("Link through Contour Cloud");
  });

  it("merges a host class name", () => {
    expect(render({ className: "card" })).toContain('class="contour-connect card"');
  });
});
