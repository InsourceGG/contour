"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/components/api";
import { useCsrf } from "@/components/csrf";
import { useToast } from "@/components/toast";

/** Company kill switch for agent (MCP) access, plus revoke-all. */
export function AgentControls({ enabled, activeGrants }: { enabled: boolean; activeGrants: number }) {
  const csrf = useCsrf();
  const router = useRouter();
  const { notify } = useToast();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState<"toggle" | "revoke" | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function toggle() {
    const next = !on;
    setBusy("toggle");
    const res = await apiPost<{ enabled?: boolean }>("/api/console/agent-access", { enabled: next }, csrf);
    setBusy(null);
    if (!res.ok) {
      notify(`Agent access wasn't changed: ${res.error.message}`, "error");
      return;
    }
    setOn(next);
    notify(next ? "Agent access turned on." : "Agent access turned off. Agents can no longer read or propose.");
    router.refresh();
  }

  async function revokeAll() {
    setBusy("revoke");
    const res = await apiPost<{ revoked?: number }>("/api/console/revoke-grants", {}, csrf);
    setBusy(null);
    setConfirming(false);
    if (!res.ok) {
      notify(`Grants weren't revoked: ${res.error.message}`, "error");
      return;
    }
    const n = res.data?.revoked ?? 0;
    notify(`Revoked ${n} agent ${n === 1 ? "connection" : "connections"}. Users must reconnect.`);
    router.refresh();
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-rule bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="agent-access-label" className="font-semibold">
              Agent access
            </h3>
            <p className="mt-1 text-sm text-ink-2">
              {on
                ? "Personal agents can describe the dashboard, read permitted data and propose views."
                : "Off. Agents are refused; people can still adapt their view in the app."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="agent-access-label"
            onClick={toggle}
            disabled={busy !== null}
            className="relative mt-1 inline-flex h-7 w-12 flex-none items-center rounded-full border transition-colors disabled:opacity-60"
            style={{
              background: on ? "var(--color-accent)" : "var(--color-rule)",
              borderColor: on ? "var(--color-accent)" : "var(--color-rule-strong)",
            }}
          >
            <span
              aria-hidden="true"
              className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{ transform: on ? "translateX(24px)" : "translateX(3px)" }}
            />
          </button>
        </div>
        <p className="meta mt-2">Status: {on ? "On" : "Off"}</p>
      </div>

      <div className="rounded-xl border border-rule bg-white p-4">
        <h3 className="font-semibold">Revoke all agent connections</h3>
        <p className="mt-1 text-sm text-ink-2">
          Disconnects every agent for everyone in your company ({activeGrants} active). Saved views are not affected.
        </p>
        {!confirming ? (
          <button type="button" className="btn btn-danger mt-3" onClick={() => setConfirming(true)} disabled={busy !== null || activeGrants === 0}>
            Revoke all connections
          </button>
        ) : (
          <div role="group" aria-label="Confirm revoking all agent connections" className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger-solid" onClick={revokeAll} disabled={busy !== null}>
              {busy === "revoke" ? "Revoking…" : `Yes, revoke ${activeGrants}`}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
