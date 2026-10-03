import "server-only";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { assertSession, checkDbError } from "./shared";
import type { Session, UserSettings } from "./types";
const settingsSchema = z.object({ displayName: z.string().trim().min(1).max(80), emailNotifications: z.boolean(), slaNotifications: z.boolean(), dailyDigest: z.boolean() });
/** Read only the current user's saved profile and notification preferences. */
export async function getUserSettings(session: Session): Promise<UserSettings> {
  assertSession(session);
  const { data, error } = await getDb().from("user_settings").select("display_name,email_notifications,sla_notifications,daily_digest").eq("user_id", session.userId).maybeSingle();
  checkDbError(error);
  return data ? { displayName: data.display_name, emailNotifications: data.email_notifications, slaNotifications: data.sla_notifications, dailyDigest: data.daily_digest } : { displayName: session.name, emailNotifications: true, slaNotifications: true, dailyDigest: false };
}
/** Save the current user's settings and update the account display name. */
export async function saveUserSettings(session: Session, input: UserSettings): Promise<void> {
  assertSession(session);
  const settings = settingsSchema.parse(input);
  const saved = await getDb().from("user_settings").upsert({ user_id: session.userId, display_name: settings.displayName, email_notifications: settings.emailNotifications, sla_notifications: settings.slaNotifications, daily_digest: settings.dailyDigest, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  checkDbError(saved.error);
  const updated = await getDb().from("users").update({ name: settings.displayName }).eq("id", session.userId);
  checkDbError(updated.error);
}
