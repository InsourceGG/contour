"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { overviewManifest } from "@/host/manifest";
import type { DensityPreference, HelpPreference, ProposeRequest, ProposeResult, UserPreferences } from "@contour/sdk/core";
import { apiPost, newKey, type ApiError } from "@/components/api";
import { useCsrf } from "@/components/csrf";
import { IconAlert, IconInfo } from "@/components/icons";
import type { Credits } from "./DashboardClient";
import { HELP_LABEL, expertiseLabel, taskLabel } from "./labels";

const MAX_NOTE = overviewManifest.limits.maxNoteLength;

type Outcome =
  | { kind: "keep"; reason: string }
  | { kind: "ask"; question: string; choices: Record<string, readonly string[]> }
  | { kind: "error"; error: ApiError; status: number };

type Props = {
  id: string;
  baseRevision: number;
  prefs: UserPreferences;
  credits: Credits;
  onClose: () => void;
};

/** In-app path to the same broker the agent uses: explicit task + expertise → READY / KEEP / ASK. */
export function AdaptPanel({ id, baseRevision, prefs, credits, onClose }: Props) {
  const csrf = useCsrf();
  const router = useRouter();
  const formId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [task, setTask] = useState<string>("");
  const [expertise, setExpertise] = useState<string>(prefs.expertise ?? "");
  const [density, setDensity] = useState<DensityPreference | "">(prefs.density ?? "");
  const [help, setHelp] = useState<HelpPreference | "">(prefs.help ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (outcome) resultRef.current?.focus();
  }, [outcome]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!task || !expertise) return;
    setBusy(true);
    setOutcome(null);
    const preferences: NonNullable<ProposeRequest["preferences"]> = {
      ...(density ? { density } : {}),
      ...(help ? { help } : {}),
    };
    const body: ProposeRequest = {
      surfaceId: overviewManifest.surfaceId,
      baseRevision,
      task: { id: task, source: "explicit" },
      expertise: { level: expertise, source: "explicit" },
      ...(Object.keys(preferences).length ? { preferences } : {}),
      ...(note.trim() ? { note: note.trim().slice(0, MAX_NOTE) } : {}),
      requestId: newKey(),
    };
    const res = await apiPost<ProposeResult>("/api/host/proposals", body, csrf);
    if (!res.ok) {
      setBusy(false);
      setOutcome({ kind: "error", error: res.error, status: res.status });
      return;
    }
    const r = res.data;
    if (r.outcome === "READY") {
      const path = previewPath(r.previewUrl, r.proposalId);
      router.push(path);
      return;
    }
    setBusy(false);
    if (r.outcome === "KEEP") setOutcome({ kind: "keep", reason: r.reason });
    else setOutcome({ kind: "ask", question: r.question, choices: r.supportedChoices });
  }

  function applyChoice(key: string, value: string) {
    if (key === "task") setTask(value);
    else if (key === "expertise") setExpertise(value);
    else if (key === "density" && (value === "comfortable" || value === "compact")) setDensity(value);
    else if (key === "help" && (value === "auto" || value === "show" || value === "hide")) setHelp(value);
    setOutcome(null);
  }

  return (
    <section id={id} aria-labelledby={`${formId}-h`} className="panel p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${formId}-h`} ref={headingRef} tabIndex={-1} className="text-xl font-semibold">
            Adapt my view
          </h2>
          <p className="mt-1 max-w-[65ch] text-sm text-ink-2">
            Your choices describe what you&apos;re doing, not what you&apos;re allowed to see. Permissions and required
            actions stay the same in every view.
          </p>
        </div>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      <form onSubmit={submit} className="mt-5 grid gap-6 lg:grid-cols-2" aria-describedby={`${formId}-credit`}>
        <fieldset>
          <legend className="field-label">What are you doing now?</legend>
          <div className="grid gap-2">
            {overviewManifest.tasks.map((t) => (
              <label key={t.id} className="choice">
                <input type="radio" name={`${formId}-task`} value={t.id} checked={task === t.id} onChange={() => setTask(t.id)} required />
                <span>
                  <span className="block font-semibold">{t.label}</span>
                  <span className="block text-sm text-ink-2">{t.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="field-label">How familiar are you with this dashboard?</legend>
          <div className="grid gap-2">
            {overviewManifest.expertiseLevels.map((x) => (
              <label key={x.id} className="choice">
                <input
                  type="radio"
                  name={`${formId}-expertise`}
                  value={x.id}
                  checked={expertise === x.id}
                  onChange={() => setExpertise(x.id)}
                  required
                />
                <span>
                  <span className="block font-semibold">{x.label}</span>
                  <span className="block text-sm text-ink-2">{x.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${formId}-density`} className="field-label">
              Density <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <select
              id={`${formId}-density`}
              className="select"
              value={density}
              onChange={(e) => setDensity(e.target.value as DensityPreference | "")}
            >
              <option value="">No preference</option>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${formId}-help`} className="field-label">
              Help <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <select id={`${formId}-help`} className="select" value={help} onChange={(e) => setHelp(e.target.value as HelpPreference | "")}>
              <option value="">No preference</option>
              {(["auto", "show", "hide"] as const).map((h) => (
                <option key={h} value={h}>
                  {HELP_LABEL[h]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor={`${formId}-note`} className="field-label">
            Anything else? <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <textarea
            id={`${formId}-note`}
            className="textarea"
            rows={2}
            maxLength={MAX_NOTE}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby={`${formId}-note-count`}
            placeholder="For example: I review numbers on a small laptop screen."
          />
          <p id={`${formId}-note-count`} className="field-hint mt-1">
            {note.length} of {MAX_NOTE} characters. Treated as context only; it can&apos;t change company rules.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-rule pt-4 lg:col-span-2 lg:flex-row lg:items-center lg:justify-between">
          <p id={`${formId}-credit`} className="flex items-start gap-2 text-sm text-ink-2">
            <IconInfo size={16} className="mt-0.5 flex-none text-info" />
            <span>
              A ready proposal uses one credit, even if you keep your current view. If we suggest keeping your view or
              ask a question, no credit is used. You have <strong className="text-ink">{credits.available}</strong>.
            </span>
          </p>
          <button type="submit" className="btn btn-primary" disabled={busy || !task || !expertise}>
            {busy ? "Preparing a proposal…" : "Request a proposed view"}
          </button>
        </div>
      </form>

      <div ref={resultRef} tabIndex={-1} aria-live="polite" className="mt-4 empty:hidden">
        {outcome && <OutcomeView outcome={outcome} onChoice={applyChoice} />}
      </div>
    </section>
  );
}

function previewPath(previewUrl: string, proposalId: string): string {
  try {
    const u = new URL(previewUrl, window.location.origin);
    if (u.pathname.startsWith("/preview/")) return u.pathname;
  } catch {
    // fall through
  }
  return `/preview/${encodeURIComponent(proposalId)}`;
}

function choiceLabel(key: string, value: string): string {
  if (key === "task") return taskLabel(value);
  if (key === "expertise") return expertiseLabel(value);
  if (key === "help") return HELP_LABEL[value] ?? value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function OutcomeView({ outcome, onChoice }: { outcome: Outcome; onChoice: (k: string, v: string) => void }) {
  if (outcome.kind === "keep") {
    return (
      <div className="notice notice-info">
        <IconInfo size={18} />
        <div>
          <p className="font-semibold">Your current view already fits. No change proposed, and no credit used.</p>
          <p className="text-ink-2">{outcome.reason}</p>
        </div>
      </div>
    );
  }
  if (outcome.kind === "ask") {
    return (
      <div className="notice notice-info">
        <IconInfo size={18} />
        <div>
          <p className="font-semibold">One question before we propose a view</p>
          <p className="text-ink-2">{outcome.question}</p>
          {Object.entries(outcome.choices).map(([key, values]) => (
            <div key={key} className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Choose ${key}`}>
              {values.map((v) => (
                <button key={v} type="button" className="btn btn-sm" onClick={() => onChoice(key, v)}>
                  {choiceLabel(key, v)}
                </button>
              ))}
            </div>
          ))}
          <p className="meta mt-2">Pick an answer, then request the view again. No credit was used.</p>
        </div>
      </div>
    );
  }
  const { error, status } = outcome;
  return (
    <div className="notice notice-error" role="alert">
      <IconAlert size={18} />
      <div>
        {status === 402 || error.code === "PAYMENT_REQUIRED" ? (
          <>
            <p className="font-semibold">You need a credit to request a proposal.</p>
            <p className="text-ink-2">
              <Link href="/billing" className="link">
                Buy a credit on the billing page
              </Link>
              , then try again.
            </p>
          </>
        ) : status === 409 || error.code === "STALE_REVISION" ? (
          <>
            <p className="font-semibold">Your view changed since this page loaded.</p>
            <p className="text-ink-2">Reload the page to get the latest view, then request again.</p>
          </>
        ) : status === 429 || error.code === "RATE_LIMITED" ? (
          <>
            <p className="font-semibold">Too many requests.</p>
            <p className="text-ink-2">Wait a minute, then try again.</p>
          </>
        ) : (
          <>
            <p className="font-semibold">We couldn&apos;t prepare a proposal.</p>
            <p className="text-ink-2">{error.message} Your current view is unchanged.</p>
          </>
        )}
      </div>
    </div>
  );
}
