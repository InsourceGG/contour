"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ViewPreview } from "@contour/sdk/react";
import type { ChangeItem, ViewConfig, ViewSnapshot } from "@contour/sdk/core";
import { componentMap, type DeskHostData } from "./components";
import { componentLabels, manifest } from "./manifest";

/** Must match the SDK's CSRF_HEADER, which lives in the server-only entry. */
const CSRF_HEADER = "x-contour-csrf";

const messages: Record<string, string> = {
  STALE_REVISION: "Your desk view changed after this proposal was made. Ask your agent for a new proposal.",
  EXPIRED_PROPOSAL: "This proposal expired before it was accepted. Ask your agent for a new one.",
  HASH_MISMATCH: "This proposal doesn't match what this page showed. Reload the page to review it again.",
  INVALID_CONFIG: "This proposal no longer passes company rules, so it can't be applied.",
  INCOMPATIBLE_MANIFEST: "The desk, its rules, or your role changed after this proposal was made.",
  PROPOSAL_NOT_READY: "This proposal was already accepted, declined, or replaced.",
  UNAUTHENTICATED: "Your session has expired. Sign in and open this proposal again.",
  FORBIDDEN: "You no longer have access to this desk view.",
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
};

function idempotencyKey() {
  return `nw-${crypto.randomUUID()}`;
}

/** Before and after comparison using the desk's own panels in read-only preview mode. */
export function PreviewComparison(props: { current: ViewSnapshot; proposed: ViewConfig; changes: ChangeItem[]; data: Partial<DeskHostData>; proposedData: Partial<DeskHostData> }) {
  return <ViewPreview manifest={manifest} componentMap={componentMap} componentLabels={componentLabels} {...props} />;
}

/** Accept saves the stored proposal by ID and hash; Keep current declines it. Only this signed-in page can do either. */
export function PreviewActions({ proposalId, configHash, csrfToken }: { proposalId: string; configHash: string; csrfToken: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "keep" | null>(null);
  const [error, setError] = useState("");
  // One key per approval so a retry or double click can't apply twice.
  const acceptKey = useRef<string | null>(null);

  async function post(action: "apply" | "reject", body: object) {
    const response = await fetch(`/api/host/proposals/${encodeURIComponent(proposalId)}/${action}`, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json", [CSRF_HEADER]: csrfToken },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as { error?: { code?: string }; revision?: number } | null;
    // The SDK wraps errors as { error: { code, message } }; only known codes get copy.
    if (!response.ok) throw new Error(messages[result?.error?.code ?? ""] ?? "Unable to save this change. Try again.");
    return result;
  }

  async function accept() {
    acceptKey.current ??= idempotencyKey();
    setBusy("accept"); setError("");
    try {
      const result = await post("apply", { configHash, idempotencyKey: acceptKey.current });
      router.push(typeof result?.revision === "number" ? `/desk?applied=${result.revision}` : "/desk");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this change. Try again.");
      setBusy(null);
    }
  }

  async function keep() {
    setBusy("keep"); setError("");
    try {
      await post("reject", {});
      router.push("/desk");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this change. Try again.");
      setBusy(null);
    }
  }

  return <div className="contour-preview-actions">
    {error && <p className="notice notice-error" role="alert">Your desk view was not changed. {error}</p>}
    <button type="button" className="button button-primary" onClick={accept} disabled={busy !== null}>{busy === "accept" ? "Accepting…" : "Accept proposed view"}</button>
    <button type="button" className="button" onClick={keep} disabled={busy !== null}>{busy === "keep" ? "Keeping…" : "Keep current view"}</button>
    <Link className="button" href="/desk">Close</Link>
  </div>;
}
