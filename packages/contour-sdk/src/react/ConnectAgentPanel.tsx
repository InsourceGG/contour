"use client";

import { useEffect, useId, useRef, useState } from "react";

export type ConnectAgentPanelProps = {
  /** Origin of Contour Cloud, e.g. "https://cloud.contour.example". With `projectId`, adds the Cloud link. */
  cloudUrl?: string;
  projectId?: string;
  /** Shown in the heading context and used to name the MCP server in the command. */
  projectName: string;
  /** The app's MCP endpoint, e.g. "https://app.example.com/api/mcp". */
  mcpUrl: string;
  className?: string;
};

/** "Acme Ops" -> "acme-ops": a safe MCP server name for the shell command. */
function serverName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "contour";
}

/**
 * Tells a signed-in user how to connect an AI agent to this app. Unstyled
 * beyond its structure: every class starts with `contour-connect` so the host
 * styles it with its own CSS. Native button and link focus rings are left
 * untouched, so focus stays visible unless the host overrides them.
 */
export function ConnectAgentPanel({ cloudUrl, projectId, projectName, mcpUrl, className }: ConnectAgentPanelProps) {
  const headingId = useId();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const command = `claude mcp add --transport http ${serverName(projectName)} ${mcpUrl}`;
  const cloudHref =
    cloudUrl && projectId ? `${cloudUrl.replace(/\/+$/, "")}/link/start?project=${encodeURIComponent(projectId)}` : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className={className ? `contour-connect ${className}` : "contour-connect"} aria-labelledby={headingId}>
      <h2 id={headingId} className="contour-connect-heading">
        Connect your AI agent
      </h2>
      <p className="contour-connect-intro">
        Your agent can describe this screen, read data you can already see, and propose views you approve here. It can never save
        changes itself.
      </p>
      <div className="contour-connect-command">
        <pre className="contour-connect-code" tabIndex={0} aria-label={`Command to connect ${projectName}`}>
          <code>{command}</code>
        </pre>
        <button type="button" className="contour-connect-copy" onClick={copy}>
          {copied ? "Copied" : "Copy command"}
        </button>
        <span className="contour-connect-status" role="status" aria-live="polite">
          {copied ? "Command copied to the clipboard" : ""}
        </span>
      </div>
      {cloudHref ? (
        <p className="contour-connect-cloud">
          <a className="contour-connect-link" href={cloudHref}>
            Link through Contour Cloud
          </a>
        </p>
      ) : null}
    </section>
  );
}
