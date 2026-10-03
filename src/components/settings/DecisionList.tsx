import { expertiseLabel, taskLabel } from "@/components/dashboard/labels";
import { formatDateTime, formatMoney, formatMs, formatNumber } from "@/components/format";

export type DecisionRow = {
  id: string;
  createdAt: string | null;
  channel: string;
  clientId: string;
  outcome: string;
  outcomeReason: string | null;
  selectedId: string | null;
  candidateIds: string[];
  confidence: number | null;
  confidenceFloor: number;
  validation: string;
  providerStatus: string;
  modelVersion: string | null;
  totalLatencyMs: number;
  providerLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  providerCost: number | null;
  currency: string | null;
  task: string | null;
  expertise: string | null;
  rationale: string | null;
  proposalId: string | null;
};

const OUTCOME: Record<string, { label: string; badge: string }> = {
  previewed: { label: "Proposed", badge: "badge-accent" },
  kept: { label: "Kept current view", badge: "" },
  asked: { label: "Asked a question", badge: "badge-info" },
  rejected_input: { label: "Request rejected", badge: "badge-warning" },
  error: { label: "Failed safely, view kept", badge: "badge-warning" },
};

const VALIDATION: Record<string, string> = { passed: "Passed", failed: "Failed, nothing saved", not_run: "Not needed" };

export function DecisionList({ rows }: { rows: DecisionRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-3 text-ink-2">No requests yet. Use Adapt my view on the dashboard, or ask your connected agent.</p>;
  }
  return (
    <ul className="mt-3 space-y-3">
      {rows.map((d) => {
        const o = OUTCOME[d.outcome] ?? { label: d.outcome, badge: "" };
        return (
          <li key={d.id} className="panel p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${o.badge}`}>{o.label}</span>
              <span className="font-semibold">
                {d.task ? taskLabel(d.task) : "Unspecified task"}
                {d.expertise ? `, ${expertiseLabel(d.expertise).toLowerCase()}` : ""}
              </span>
              <span className="meta">
                {d.channel === "mcp" ? `From agent ${d.clientId}` : "From this app"}
                {d.createdAt ? `, ${formatDateTime(d.createdAt)}` : ""}
              </span>
            </div>
            {(d.rationale || d.outcomeReason) && <p className="mt-2 max-w-[75ch] text-sm text-ink-2">{d.rationale ?? d.outcomeReason}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <Item label="Options considered" value={d.candidateIds.join(", ") || "—"} />
              <Item label="Selected" value={d.selectedId ?? (d.outcome === "kept" ? "KEEP" : d.outcome === "asked" ? "ASK" : "—")} />
              <Item
                label="Confidence"
                value={d.confidence === null ? "—" : `${formatNumber(d.confidence, 2)} (needs ${formatNumber(d.confidenceFloor, 2)})`}
              />
              <Item label="Company rules" value={VALIDATION[d.validation] ?? d.validation} />
              <Item
                label="Time taken"
                value={`${formatMs(d.totalLatencyMs)}${d.providerLatencyMs !== null ? `, model ${formatMs(d.providerLatencyMs)}` : ""}`}
              />
              <Item
                label="Tokens and cost"
                value={`${d.inputTokens ?? "—"} in, ${d.outputTokens ?? "—"} out, ${
                  d.providerCost !== null && d.currency ? formatMoney(d.providerCost, d.currency.toUpperCase()) : "cost not reported"
                }`}
              />
            </dl>
            <p className="meta mt-2">
              Model {d.modelVersion ?? "not called"}, provider status {d.providerStatus}
              {d.outcomeReason && d.rationale ? `. Outcome note: ${d.outcomeReason}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
