"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskList } from "@/host/readers/types";
import { apiPost } from "@/components/api";
import { useCsrf } from "@/components/csrf";
import { useToast } from "@/components/toast";
import { formatDateTime } from "@/components/format";
import { IconCheck } from "@/components/icons";
import { useComponentState } from "@/sdk/react/component-state";
import { HostCard, Unavailable } from "./HostCard";
import { setting, type HostComponentProps } from "./types";

type Task = TaskList["tasks"][number];

const PRIORITY: Record<Task["priority"], { label: string; badge: string }> = {
  high: { label: "High", badge: "badge-critical" },
  medium: { label: "Medium", badge: "badge-warning" },
  low: { label: "Low", badge: "" },
};

const FILTER_LABEL = { all: "All tasks", mine: "Assigned to you first", overdue: "Overdue first" } as const;

/** Required task queue. Acknowledge is a required action and is present in every variant. */
export function Tasks({ placement, data, preview }: HostComponentProps<TaskList>) {
  const variant = placement.variantId;
  const filter = setting(placement.settings, "filter", ["all", "mine", "overdue"] as const, "all");
  const limit = setting(placement.settings, "limit", [5, 10] as const, 5);
  const [draft, setDraft] = useComponentState<string>("tasks", "draftNote", "");
  const [acked, setAcked] = useComponentState<string[]>("tasks", "acknowledged", []);
  const noteId = useId();

  const tasks = data ? orderTasks(data.tasks, filter).slice(0, limit) : [];
  const ackedSet = new Set(acked);

  return (
    <HostCard
      placement={placement}
      title="Your tasks"
      subtitle={data ? `${FILTER_LABEL[filter]}, showing ${tasks.length} of ${data.total}` : undefined}
    >
      {!data ? (
        <Unavailable what="Your task list" />
      ) : tasks.length === 0 ? (
        <p className="text-ink-2">No tasks match this filter. New assignments appear here.</p>
      ) : (
        <ul className="flex flex-col" style={{ gap: variant === "compact" ? 0 : "var(--cs-row)" }}>
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              variant={variant}
              preview={!!preview}
              acknowledged={t.status !== "open" || ackedSet.has(t.id)}
              onAcknowledged={() => setAcked([...acked.filter((id) => id !== t.id), t.id])}
            />
          ))}
        </ul>
      )}

      <div className="mt-[calc(var(--cs-row)*1.5)] border-t border-rule pt-[var(--cs-row)]">
        <label htmlFor={noteId} className="field-label text-[length:var(--cs-fs-sm)]">
          Handoff note (draft, kept on this device)
        </label>
        <input
          id={noteId}
          className="input"
          type="text"
          maxLength={500}
          value={draft}
          disabled={preview}
          placeholder="What should the next person know?"
          onChange={(e) => setDraft(e.target.value)}
          data-testid="task-draft-note"
        />
      </div>
    </HostCard>
  );
}

function orderTasks(tasks: Task[], filter: "all" | "mine" | "overdue"): Task[] {
  const rank = (t: Task) => (filter === "overdue" ? (t.overdue ? 0 : 1) : filter === "mine" ? (t.assignedToMe ? 0 : 1) : 0);
  const pr = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => rank(a) - rank(b) || pr[a.priority] - pr[b.priority] || a.dueAt.localeCompare(b.dueAt));
}

type RowProps = {
  task: Task;
  variant: string;
  preview: boolean;
  acknowledged: boolean;
  onAcknowledged: () => void;
};

function TaskRow({ task, variant, preview, acknowledged, onAcknowledged }: RowProps) {
  const p = PRIORITY[task.priority];
  const due = (
    <span className={task.overdue ? "font-semibold text-critical" : undefined}>
      {task.overdue ? "Overdue, was due " : "Due "}
      {formatDateTime(task.dueAt)}
    </span>
  );

  if (variant === "compact") {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule py-[var(--cs-row)] last:border-b-0">
        <span className={`badge ${p.badge}`}>{p.label}</span>
        <span className="min-w-0 flex-1 truncate font-medium" title={task.title}>
          {task.title}
        </span>
        <span className="text-[length:var(--cs-fs-sm)] text-ink-3">{due}</span>
        <AckButton task={task} preview={preview} acknowledged={acknowledged} onAcknowledged={onAcknowledged} />
      </li>
    );
  }

  return (
    <li className="rounded-[10px] border border-rule bg-white" style={{ padding: "calc(var(--cs-pad) * 0.7)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className={`badge ${p.badge}`}>{p.label} priority</span>
            <strong className="font-semibold">{task.title}</strong>
          </p>
          <p className="mt-1 text-[length:var(--cs-fs-sm)] text-ink-2">
            {due}
            {variant === "detailed" && <span>. {task.assignedToMe ? "Assigned to you" : "Team queue"}</span>}
          </p>
        </div>
        <AckButton task={task} preview={preview} acknowledged={acknowledged} onAcknowledged={onAcknowledged} />
      </div>
      {variant === "detailed" && (
        <>
          <p className="mt-2 text-ink-2">{task.context}</p>
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[length:var(--cs-fs-sm)] text-ink-2">
            <li>Read the context and check related alerts.</li>
            <li>Acknowledge to confirm you own it.</li>
            <li>Resolve it in the source system, then leave a handoff note.</li>
          </ol>
        </>
      )}
    </li>
  );
}

function AckButton({
  task,
  preview,
  acknowledged,
  onAcknowledged,
}: {
  task: Task;
  preview: boolean;
  acknowledged: boolean;
  onAcknowledged: () => void;
}) {
  const csrf = useCsrf();
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  if (acknowledged) {
    return (
      <span className="badge badge-accent" aria-label={`${task.title}: acknowledged`}>
        <IconCheck size={12} />
        Acknowledged
      </span>
    );
  }

  async function acknowledge() {
    setBusy(true);
    const res = await apiPost(`/api/host/tasks/${encodeURIComponent(task.id)}/acknowledge`, {}, csrf);
    setBusy(false);
    if (res.ok) {
      onAcknowledged();
      notify(`Acknowledged “${task.title}”`);
      router.refresh();
    } else {
      notify(`Couldn't acknowledge “${task.title}”: ${res.error.message}`, "error");
    }
  }

  return (
    <button
      type="button"
      className="btn btn-sm btn-primary"
      disabled={preview || busy}
      aria-label={`Acknowledge: ${task.title}`}
      onClick={acknowledge}
    >
      {busy ? "Acknowledging…" : "Acknowledge"}
    </button>
  );
}
