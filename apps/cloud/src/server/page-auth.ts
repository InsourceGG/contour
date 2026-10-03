import "server-only";
import { redirect } from "next/navigation";
import { ContourError } from "@contour/sdk/core";
import { resolveHostUser } from "./context";
export async function pageUser(next: string) {
  try { return await resolveHostUser(); }
  catch (error) {
    if (error instanceof ContourError && error.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(next)}`);
    throw error;
  }
}
