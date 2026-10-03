import Link from "next/link";
import type { PreviewState } from "@contour/sdk/core";
import { IconAlert, IconCheck, IconInfo } from "@/components/icons";

const COPY: Record<Exclude<PreviewState, "ready">, { title: string; body: string; tone: "info" | "warning" | "success" }> = {
  expired: {
    title: "This proposal expired",
    body: "Proposals are valid for a limited time. Request a new one to see a fresh comparison.",
    tone: "warning",
  },
  stale: {
    title: "Your view changed after this proposal was made",
    body: "It was prepared for an earlier revision, so applying it could overwrite newer changes. Request a new proposal.",
    tone: "warning",
  },
  invalid: {
    title: "This proposal no longer meets company rules",
    body: "The screen, its policy or your access changed. It can't be applied. Request a new proposal.",
    tone: "warning",
  },
  applied: {
    title: "Already applied",
    body: "This proposal is already your saved view.",
    tone: "success",
  },
  rejected: {
    title: "You kept your current view",
    body: "This proposal was declined. It can't be applied now.",
    tone: "info",
  },
};

export function PreviewStateNotice({
  state,
  reason,
  appliedRevision,
}: {
  state: PreviewState;
  reason: string | null;
  appliedRevision: number | null;
}) {
  if (state === "ready") return null;
  const c = COPY[state];
  const Icon = c.tone === "success" ? IconCheck : c.tone === "warning" ? IconAlert : IconInfo;
  return (
    <div role="status" className={`notice notice-${c.tone}`}>
      <Icon size={18} />
      <div>
        <p className="font-semibold">{c.title}</p>
        <p className="text-ink-2">
          {reason ?? c.body}
          {state === "applied" && appliedRevision ? ` It became revision ${appliedRevision}.` : ""}
        </p>
        <Link href="/" className="link mt-1 inline-block text-sm">
          Go to the dashboard
        </Link>
      </div>
    </div>
  );
}
