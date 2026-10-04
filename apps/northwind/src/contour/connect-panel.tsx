"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectAgentPanel } from "@contour/sdk/react";

const CSRF_HEADER = "x-contour-csrf";

export type ConnectedAgent = { id: string; clientName: string; verified: boolean; createdAt: string };

/** Agent connection controls in Settings, styled with Northwind's settings aside. */
export function AgentConnections({ mcpUrl, cloudUrl, projectId, agentAccess, cloudNotice, agents, csrfToken }: {
  mcpUrl: string; cloudUrl?: string; projectId?: string; agentAccess: boolean; cloudNotice?: string; agents: ConnectedAgent[]; csrfToken: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function disconnect(agent: ConnectedAgent) {
    setPending(agent.id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/host/agents/${encodeURIComponent(agent.id)}/revoke`, {
        method: "POST", credentials: "same-origin", headers: { Accept: "application/json", [CSRF_HEADER]: csrfToken },
      });
      if (!response.ok) throw new Error();
      setMessage(`${agent.clientName} is disconnected.`);
      router.refresh();
    } catch {
      setError("Unable to disconnect this agent. Reload the page and try again.");
    } finally { setPending(null); }
  }

  return <section className="integration-placeholder" aria-labelledby="agents-heading">
    <h2 id="agents-heading">AI agents</h2>
    {agentAccess
      ? <ConnectAgentPanel projectName="Northwind Support" mcpUrl={mcpUrl} cloudUrl={cloudUrl} projectId={projectId} />
      : <p>Agent access is turned off for Northwind. An administrator can turn it back on in Admin.</p>}
    {cloudNotice && <p className="field-hint">{cloudNotice}</p>}
    {agents.length > 0 ? <ul className="contour-agents">{agents.map((agent) => <li key={agent.id}>
      <span><strong>{agent.clientName}</strong><span className="field-hint">{agent.verified ? "Listed by your company" : "Name not verified"} · connected {new Date(agent.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span></span>
      <button type="button" className="button button-small" disabled={pending !== null} onClick={() => void disconnect(agent)} aria-label={`Disconnect ${agent.clientName}`}>{pending === agent.id ? "Disconnecting…" : "Disconnect"}</button>
    </li>)}</ul> : <span className="neutral-badge">No agents connected</span>}
    <p className="field-hint" role="status">{message}</p>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
  </section>;
}
