"use client";

import { useEffect, useReducer, useRef } from "react";
import type { LiveData } from "../core/broker";
import { initialLiveState, livePollDelay, liveReducer, type ContourLiveError } from "./live-state";

export type UseContourLiveOptions = { endpoint: string; intervalMs?: number; enabled?: boolean };
export type UseContourLiveResult = Omit<LiveData, "revision" | "configHash"> & { revision: number | null; configHash: string | null; error: ContourLiveError | null };

/** Polls the authenticated host endpoint; it has no authority to commit a view. */
export function useContourLive({ endpoint, intervalMs = 1200, enabled = true }: UseContourLiveOptions): UseContourLiveResult {
  const [state, dispatch] = useReducer(liveReducer, initialLiveState);
  const lastStarted = useRef(-Infinity);
  useEffect(() => {
    dispatch({ type: "reset" });
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let failures = 0;
    function schedule() {
      if (stopped || document.hidden || controller) return;
      clearTimeout(timer);
      timer = setTimeout(tick, Math.max(0, lastStarted.current + livePollDelay(intervalMs, failures) - Date.now()));
    }
    async function tick() {
      if (stopped || document.hidden || controller) return;
      lastStarted.current = Date.now();
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      try {
        const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw { code: data?.error?.code ?? "LIVE_UNAVAILABLE" };
        if (!data || typeof data.revision !== "number" || typeof data.configHash !== "string" || !("job" in data) || !("proposal" in data)) throw { code: "LIVE_UNAVAILABLE" };
        if (!stopped) { dispatch({ type: "received", data }); failures = 0; }
      } catch (error) {
        if (!stopped) {
          failures += 1;
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "LIVE_UNAVAILABLE";
          dispatch({ type: "failed", error: { code, message: code === "UNAUTHENTICATED" ? "Sign in again to see new proposals." : "Live updates are temporarily unavailable. Your current view still works." } });
        }
      } finally {
        clearTimeout(timeout);
        controller = null;
        schedule();
      }
    }
    function visibilityChanged() { if (document.hidden) clearTimeout(timer); else schedule(); }
    document.addEventListener("visibilitychange", visibilityChanged);
    schedule();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibilityChanged); };
  }, [endpoint, intervalMs, enabled]);
  return state;
}
