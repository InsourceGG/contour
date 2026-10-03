import "server-only";
import { readers } from "@/host/readers";
import type { SurfaceData } from "@/host/readers/types";
import { overviewManifest } from "@/host/manifest";
import type { VerifiedContext, ViewConfig } from "@/sdk/types";
import { supabaseStore } from "./store";

/**
 * Fetches reader data for the visible components of a validated config in
 * the host app. Data permission is checked fresh (membership.data_access);
 * layout visibility never grants access — a hidden component's data is
 * simply not fetched, and a visible one still requires permission.
 */
export async function getSurfaceData(ctx: VerifiedContext, config: ViewConfig): Promise<SurfaceData> {
  const membership = await supabaseStore.getMembership(ctx.subjectId, ctx.tenantId, ctx.appId);
  if (!membership || membership.status !== "active" || !membership.dataAccess || !ctx.scopes.has("data:read")) return {};
  const out: Record<string, unknown> = {};
  await Promise.all(
    config.placements
      .filter((p) => p.visible)
      .map(async (p) => {
        const spec = overviewManifest.components.find((c) => c.id === p.componentId);
        const reader = spec?.readerId ? readers.get(spec.readerId) : undefined;
        if (!spec || !reader) return;
        const input = reader.inputSchema.safeParse(pickInput(spec.readerId!, p.settings));
        if (!input.success) return;
        try {
          out[p.componentId] = await reader.read(ctx, input.data);
        } catch {
          // Leave undefined: the component's error state renders, others continue.
        }
      }),
  );
  return out as SurfaceData;
}

function pickInput(readerId: string, settings: Record<string, unknown>) {
  switch (readerId) {
    case "revenue.summary":
      return { period: settings.period };
    case "metrics.summary":
      return { set: settings.set };
    case "tasks.list":
      return { filter: settings.filter, limit: settings.limit };
    case "activity.recent":
      return { limit: settings.limit };
    default:
      return {};
  }
}
