import "server-only";
import { createClient } from "@supabase/supabase-js";
/** Privileged database access is restricted to server modules; each reader enforces team scope. */
export function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) throw new Error("Northwind database configuration is missing.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).schema("northwind");
}
