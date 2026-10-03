"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, newKey, type ApiError } from "@/components/api";
import { useCsrf } from "@/components/csrf";
import { useToast } from "@/components/toast";
import { IconReset, IconUndo } from "@/components/icons";

type Op = "undo" | "reset";

/** Undo / Reset. Both are free and create a new revision; failures are never shown as success. */
export function ViewControls({ revision, canUndo }: { revision: number; canUndo: boolean }) {
  const csrf = useCsrf();
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState<Op | null>(null);
  const [problem, setProblem] = useState<{ op: Op; error: ApiError } | null>(null);

  async function run(op: Op) {
    setBusy(op);
    setProblem(null);
    const res = await apiPost<{ revision?: number }>(
      `/api/host/view/${op}`,
      { expectedRevision: revision, idempotencyKey: newKey() },
      csrf,
    );
    setBusy(null);
    if (!res.ok) {
      setProblem({ op, error: res.error });
      return;
    }
    const r = res.data?.revision;
    notify(op === "undo" ? `Restored your previous view${r ? ` as revision ${r}` : ""}.` : `Reset to the company default${r ? ` (revision ${r})` : ""}.`);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => run("undo")} disabled={!canUndo || busy !== null}>
          <IconUndo size={16} />
          {busy === "undo" ? "Undoing…" : "Undo"}
        </button>
        <button type="button" className="btn" onClick={() => run("reset")} disabled={busy !== null}>
          <IconReset size={16} />
          {busy === "reset" ? "Resetting…" : "Reset to default"}
        </button>
      </div>
      {problem && (
        <div role="alert" className="notice notice-error max-w-md">
          <div>
            <p className="font-semibold">{problem.op === "undo" ? "Undo didn't happen." : "Reset didn't happen."}</p>
            <p className="text-ink-2">{describe(problem.error)}</p>
            {problem.error.code === "STALE_REVISION" && (
              <button type="button" className="btn btn-sm mt-2" onClick={() => router.refresh()}>
                Load the latest view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function describe(e: ApiError): string {
  switch (e.code) {
    case "STALE_REVISION":
      return `Your view changed in another tab or session${typeof e.currentRevision === "number" ? ` (now revision ${e.currentRevision})` : ""}. Load the latest view, then try again.`;
    case "INCOMPATIBLE_SNAPSHOT":
      return e.message || "Your previous layout no longer fits this screen or your access. Reset to the default instead.";
    case "RATE_LIMITED":
      return "Too many changes in a short time. Wait a minute and try again.";
    case "OFFLINE":
      return e.message;
    default:
      return `${e.message} Your current view is unchanged.`;
  }
}
