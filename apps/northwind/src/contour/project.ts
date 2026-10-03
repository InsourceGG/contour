import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Contour Cloud registration receipt ({ projectId, nonce }), written only
 * after an approved registration (checkpoint 4). Null means not registered.
 */
export function projectReceipt(): { projectId: string; nonce: string } | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), "src/contour/project.json"), "utf8")) as { projectId?: unknown; nonce?: unknown };
    return typeof raw.projectId === "string" && typeof raw.nonce === "string" ? { projectId: raw.projectId, nonce: raw.nonce } : null;
  } catch {
    return null;
  }
}
