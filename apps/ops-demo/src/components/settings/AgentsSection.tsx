"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/components/api";
import { useCsrf } from "@/components/csrf";
import { useToast } from "@/components/toast";
import { formatDateTime } from "@/components/format";
import { IconCopy } from "@/components/icons";

export type AgentGrant = {
  id: string;
  clientName: string;
  clientId: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
};

const SCOPE_LABEL: Record<string, string> = {
  "view:read": "See your view",
  "data:read": "Read permitted dashboard data",
  "view:propose": "Propose new views",
  "view:commit": "Apply views",
};

export function AgentsSection({ headingId, grants, mcpUrl }: { headingId: string; grants: AgentGrant[] | null; mcpUrl: string }) {
  const command = `claude mcp add --transport http contour ${mcpUrl}`;
  const active = (grants ?? []).filter((g) => !g.revokedAt);
  const revoked = (grants ?? []).filter((g) => g.revokedAt);

  return (
    <div className="space-y-4">
      <div>
        <h2 id={headingId} className="section-title">
          Connected agents
        </h2>
        <p className="mt-1 max-w-[70ch] text-sm text-ink-2">
          A connected agent can describe this dashboard, read the data you&apos;re allowed to see, and propose a view. It can&apos;t
          apply anything. Only you can accept a proposal, here in this app.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="panel p-4 md:p-5">
          <h3 className="font-semibold">Your connections</h3>
          {grants === null ? (
            <p role="status" className="mt-2 text-sm text-ink-2">
              Connections couldn&apos;t be loaded right now. Reload to try again.
            </p>
          ) : active.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">No agents connected yet. Follow the steps to connect one.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rule">
              {active.map((g) => (
                <GrantRow key={g.id} grant={g} />
              ))}
            </ul>
          )}
          {revoked.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-ink-2">Disconnected ({revoked.length})</summary>
              <ul className="mt-2 space-y-1 text-ink-2">
                {revoked.map((g) => (
                  <li key={g.id}>
                    {g.clientName}, disconnected {formatDateTime(g.revokedAt)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="panel p-4 md:p-5">
          <h3 className="font-semibold">Connect an agent</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            <li>
              Add Contour to your agent. For Claude Code, run:
              <CopyField value={command} label="Command to add Contour to Claude Code" />
            </li>
            <li>
              Other MCP clients use this endpoint:
              <CopyField value={mcpUrl} label="Contour MCP endpoint" />
            </li>
            <li>Sign in when your agent opens the browser, and review what it may access.</li>
            <li>Ask your agent for a view, for example “set up my dashboard for triage, I&apos;m new to this”. Review it here.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function GrantRow({ grant }: { grant: AgentGrant }) {
  const csrf = useCsrf();
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    const res = await apiPost(`/api/host/agents/${encodeURIComponent(grant.id)}/revoke`, {}, csrf);
    setBusy(false);
    if (!res.ok) {
      notify(`Couldn't disconnect ${grant.clientName}: ${res.error.message}`, "error");
      return;
    }
    notify(`Disconnected ${grant.clientName}. It can no longer read or propose.`);
    router.refresh();
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-semibold">{grant.clientName}</p>
        <p className="meta">Connected {formatDateTime(grant.createdAt)}</p>
        <ul className="mt-1 flex flex-wrap gap-1">
          {grant.scopes.map((s) => (
            <li key={s} className="badge">
              {SCOPE_LABEL[s] ?? s}
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="btn btn-sm btn-danger" onClick={revoke} disabled={busy}>
        {busy ? "Disconnecting…" : "Revoke access"}
        <span className="sr-only"> for {grant.clientName}</span>
      </button>
    </li>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="mt-1.5 flex items-stretch gap-2">
      <code className="block min-w-0 flex-1 overflow-x-auto rounded-lg border border-rule bg-white px-3 py-2 text-[13px] whitespace-nowrap" aria-label={label}>
        {value}
      </code>
      <button type="button" className="btn btn-sm" onClick={copy}>
        <IconCopy size={14} />
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        <span className="sr-only"> {label}</span>
      </button>
    </div>
  );
}
