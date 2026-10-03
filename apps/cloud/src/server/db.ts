import { createClient } from '@supabase/supabase-js';

export type CloudDb = { from(table: string): any; rpc(fn: string, args: object): any };

export function cloudDb(): CloudDb {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing Cloud database configuration');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).schema('cloud');
}
