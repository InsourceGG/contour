import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/**
 * Unscoped service-role client for Contour, created on first use from the
 * existing server-only credentials. The SDK selects northwind_contour itself;
 * Northwind business reads keep using the northwind-scoped getDb().
 */
export function getAppDb(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) throw new Error("Northwind database configuration is missing.");
  client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
