import type { LiveData } from "../core/broker";
import type { ViewConfig } from "../core/types";

export type ContourLiveError = { code: string; message: string };
export type ContourLiveState = Omit<LiveData, "revision" | "configHash"> & { revision: number | null; configHash: string | null; error: ContourLiveError | null };
export const initialLiveState: ContourLiveState = { revision: null, configHash: null, job: null, proposal: null, error: null };

export type LiveAction = { type: "received"; data: LiveData } | { type: "failed"; error: ContourLiveError } | { type: "reset" };
export function liveReducer(state: ContourLiveState, action: LiveAction): ContourLiveState {
  if (action.type === "reset") return initialLiveState;
  if (action.type === "failed") return { ...state, error: action.error };
  // The host only presents a validated, pending READY proposal.
  return { ...action.data, proposal: action.data.job?.status === "ready" && action.data.proposal?.state === "ready" && action.data.proposal.proposal.status === "READY" ? action.data.proposal : null, error: null };
}

/** No retries or visibility resumes can shorten the configured polling interval. */
export function livePollDelay(intervalMs: number, failures = 0): number {
  const interval = Number.isFinite(intervalMs) ? Math.max(1, intervalMs) : 1200;
  return interval * Math.min(2 ** Math.max(0, Math.min(5, failures)), Math.max(1, 30_000 / interval));
}

/** Once presented (or explicitly reviewed), later typing must not revert that preview. */
export function shouldDeferLiveProposal(proposalId: string | undefined, reviewedId: string | null, editing: boolean): boolean {
  return !!proposalId && proposalId !== reviewedId && editing;
}

export type LivePresentation = { config: ViewConfig; preview: boolean; highlightIds?: ReadonlySet<string> };
/** A disappearing or superseded proposal must not move the view under an editor. */
export function resolveLivePresentation(previous: LivePresentation, desired: LivePresentation, editing: boolean, reviewed = false): LivePresentation {
  const changesLayout = previous.preview !== desired.preview || JSON.stringify(previous.config) !== JSON.stringify(desired.config);
  return editing && !reviewed && changesLayout ? previous : desired;
}

export function liveActionError(error: unknown): ContourLiveError {
  const value = error && typeof error === "object" ? error as { code?: unknown; error?: { code?: unknown } } : null;
  const code = typeof value?.code === "string" ? value.code : typeof value?.error?.code === "string" ? value.error.code : "OFFLINE";
  const messages: Record<string, string> = {
    STALE_REVISION: "Your saved view changed. Request a fresh proposal to review it.",
    EXPIRED_PROPOSAL: "This proposal expired. Request a new view to try again.",
    INVALID_CONFIG: "This proposal no longer fits the dashboard. Request a new view.",
    UNAUTHENTICATED: "Your session ended. Sign in again to review this view.",
    FORBIDDEN: "You don't have permission to change this view.",
    OFFLINE: "Couldn't reach the server. Your view hasn't been saved. Try again.",
  };
  return { code, message: messages[code] ?? "Couldn't save this view. Your current view is unchanged. Try again." };
}
