"use client";

import { HostCard } from "./HostCard";
import { HELP } from "./help-content";
import { setting, type HostComponentProps } from "./types";

/** Contextual help: guide (steps), tips (definitions) or collapsed (a disclosure). */
export function Help({ placement, preview }: HostComponentProps<undefined>) {
  const topic = setting(placement.settings, "topic", ["auto", "performance", "triage"] as const, "auto");
  const content = HELP[topic];
  const variant = placement.variantId;

  if (variant === "collapsed") {
    return (
      <HostCard placement={placement} title="Help">
        {preview ? (
          <p className="text-ink-2">{content.title} (collapsed until opened)</p>
        ) : (
          <details className="group">
            <summary className="cursor-pointer font-semibold text-accent underline decoration-1 underline-offset-[3px]">
              {content.title}
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-ink-2">{content.intro}</p>
              <Steps steps={content.steps} />
            </div>
          </details>
        )}
      </HostCard>
    );
  }

  if (variant === "guide") {
    return (
      <HostCard placement={placement} title={content.title} subtitle="Step by step">
        <p className="text-ink-2">{content.intro}</p>
        <Steps steps={content.steps} />
        <Tips tips={content.tips.slice(0, 2)} />
      </HostCard>
    );
  }

  return (
    <HostCard placement={placement} title="Tips" subtitle={content.title}>
      <Tips tips={content.tips} />
    </HostCard>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-2 space-y-[calc(var(--cs-row)*0.75)]">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span
            className="grid h-6 w-6 flex-none place-items-center rounded-full border border-accent text-[12px] font-semibold text-accent"
            aria-hidden="true"
          >
            {i + 1}
          </span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function Tips({ tips }: { tips: { term: string; text: string }[] }) {
  return (
    <dl className="mt-3 space-y-[calc(var(--cs-row)*0.75)]">
      {tips.map((t) => (
        <div key={t.term}>
          <dt className="font-semibold">{t.term}</dt>
          <dd className="text-ink-2">{t.text}</dd>
        </div>
      ))}
    </dl>
  );
}
