import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Contour Cloud registration receipt ({ projectId, nonce }), written only
 * after an approved registration (checkpoint 4). Null means not registered.
 */
export function projectReceipt(): { projectId: string; nonce: string } | null {
  // Deployments set the receipt through env; local runs may use the receipt file.
  const envId = process.env.CONTOUR_PROJECT_ID;
  const envNonce = process.env.CONTOUR_PROJECT_NONCE;
  if (envId && envNonce) return { projectId: envId, nonce: envNonce };
  try {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), "src/contour/project.json"), "utf8")) as { projectId?: unknown; nonce?: unknown };
    return typeof raw.projectId === "string" && typeof raw.nonce === "string" ? { projectId: raw.projectId, nonce: raw.nonce } : null;
  } catch {
    return null;
  }
}
