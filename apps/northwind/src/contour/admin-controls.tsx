"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CSRF_HEADER = "x-contour-csrf";

/** Admin kill switch and revoke-all. "Allow agent access" off means the kill switch is on. */
export function AgentAccessControls({ enabled, csrfToken }: { enabled: boolean; csrfToken: string }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(enabled);
  const [pending, setPending] = useState<"switch" | "revoke" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function post(path: string, body: object) {
    const response = await fetch(path, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json", [CSRF_HEADER]: csrfToken },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error();
    return response.json() as Promise<{ enabled?: boolean; revoked?: number }>;
  }

  async function toggle(next: boolean) {
    setPending("switch"); setError(""); setMessage("");
    try {
      await post("/api/contour-admin/agent-access", { enabled: next });
      setAllowed(next);
      setMessage(next ? "Agent access is on." : "Agent access is off. Agents can't read or propose until you turn it back on.");
      router.refresh();
    } catch {
      setError("Unable to change agent access. Reload the page and try again.");
    } finally { setPending(null); }
  }

  async function revokeAll() {
    if (!window.confirm("Disconnect every agent connected to Northwind? People will need to reconnect them.")) return;
    setPending("revoke"); setError(""); setMessage("");
    try {
      const result = await post("/api/contour-admin/revoke-all", {});
      setMessage(`${result.revoked ?? 0} agent ${result.revoked === 1 ? "connection" : "connections"} disconnected.`);
    } catch {
      setError("Unable to disconnect agents. Reload the page and try again.");
    } finally { setPending(null); }
  }

  return <section className="settings-section" aria-labelledby="agent-access-heading">
    <h2 id="agent-access-heading">AI agent access</h2>
    <label className="preference"><input type="checkbox" checked={allowed} disabled={pending !== null} onChange={(event) => void toggle(event.target.checked)} /><span><strong>Allow agent access</strong><span>People can connect AI agents that read the desk data they already see and suggest desk layouts they approve. Turning this off disables every agent immediately.</span></span></label>
    <div className="contour-admin-actions"><button type="button" className="button" disabled={pending !== null} onClick={() => void revokeAll()}>{pending === "revoke" ? "Disconnecting…" : "Disconnect all agents"}</button></div>
    <p className="field-hint" role="status">{message}</p>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
  </section>;
}
