"use client";

import Link from "next/link";
import { formatDateTime } from "@/components/format";
import { IconChevron, IconCredit, IconPlug, IconSliders } from "@/components/icons";
import type { Credits, ProposalSummary } from "./DashboardClient";
import { expertiseLabel, taskLabel } from "./labels";

type Props = {
  adaptOpen: boolean;
  adaptPanelId: string;
  onToggleAdapt: () => void;
  proposals: ProposalSummary[];
  readyCount: number;
  credits: Credits;
};

/** Company-owned controls that sit outside the adaptable surface. */
export function ControlDock({ adaptOpen, adaptPanelId, onToggleAdapt, proposals, readyCount, credits }: Props) {
  const ready = proposals.filter((p) => p.status === "READY");
  return (
    <div className="panel grid divide-y divide-rule md:grid-cols-2 md:divide-y-0 xl:grid-cols-[1.35fr_1.25fr_0.8fr_0.9fr]">
      <section aria-labelledby="dock-adapt" className="flex flex-col gap-3 p-4 md:border-r md:border-b md:border-rule xl:border-b-0">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-accent">
            <IconSliders size={20} />
          </span>
          <div>
            <h2 id="dock-adapt" className="text-base font-semibold">
              Adapt my view
            </h2>
            <p className="text-sm text-ink-2">Tell us your task and experience. You&apos;ll preview the result before anything changes.</p>
          </div>
        </div>
        <button
          type="button"
          className={`btn ${adaptOpen ? "" : "btn-primary"} self-start`}
          aria-expanded={adaptOpen}
          aria-controls={adaptPanelId}
          onClick={onToggleAdapt}
        >
          {adaptOpen ? "Hide options" : "Choose task and expertise"}
          <IconChevron size={16} style={{ transform: adaptOpen ? "rotate(180deg)" : undefined }} />
        </button>
      </section>

      <section aria-labelledby="dock-proposals" className="p-4 md:border-b md:border-rule xl:border-r xl:border-b-0">
        <h2 id="dock-proposals" className="text-base font-semibold">
          Proposals to review{" "}
          {readyCount > 0 && (
            <span className="badge badge-accent ml-1 align-middle">{readyCount} ready</span>
          )}
        </h2>
        {ready.length === 0 ? (
          <p className="mt-1 text-sm text-ink-2">None waiting. Proposals from this page or your agent appear here.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {ready.slice(0, 3).map((p) => (
              <li key={p.id} className="text-sm">
                <Link href={`/preview/${p.id}`} className="link">
                  {taskLabel(p.task)}, {expertiseLabel(p.expertise).toLowerCase()}
                </Link>
                <span className="meta block">
                  {p.changeCount} {p.changeCount === 1 ? "change" : "changes"}, expires {formatDateTime(p.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dock-credits" className="p-4 md:border-r md:border-rule">
        <h2 id="dock-credits" className="flex items-center gap-2 text-base font-semibold">
          <IconCredit size={18} className="text-ink-3" />
          Credits
        </h2>
        <p className="mt-1">
          <span className="text-2xl font-semibold">{credits.available}</span>{" "}
          <span className="text-sm text-ink-2">available</span>
        </p>
        <Link href="/billing" className="link text-sm">
          Billing and usage
        </Link>
      </section>

      <section aria-labelledby="dock-agent" className="p-4">
        <h2 id="dock-agent" className="flex items-center gap-2 text-base font-semibold">
          <IconPlug size={18} className="text-ink-3" />
          Connect your agent
        </h2>
        <p className="mt-1 text-sm text-ink-2">Let your AI assistant propose views. Only you can accept them.</p>
        <Link href="/settings#agents" className="link text-sm">
          Set up an agent
        </Link>
      </section>
    </div>
  );
}
