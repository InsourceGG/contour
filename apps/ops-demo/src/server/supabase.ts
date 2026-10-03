import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "./env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS, so every query made with it MUST apply
 * explicit tenant/app/subject/surface filters and the caller must have
 * enforced membership. Never expose to browsers, agents or prompts.
 */
export function adminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(env.supabaseUrl, env.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/** Cookie-bound Supabase client for the signed-in host-app user (RLS applies). */
export async function userClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component; the proxy refreshes the session.
        }
      },
    },
  });
}
