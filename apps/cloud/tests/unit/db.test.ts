import { afterEach, expect, it, vi } from 'vitest';
const { createClient, schema } = vi.hoisted(() => ({ createClient: vi.fn(), schema: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import { cloudDb } from '../../src/server/db.js';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('creates a server client scoped to cloud without browser auth persistence', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'test-service-key');
  const scoped = { from: vi.fn(), rpc: vi.fn() };
  schema.mockReturnValue(scoped); createClient.mockReturnValue({ schema });
  expect(cloudDb()).toBe(scoped);
  expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'test-service-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  expect(schema).toHaveBeenCalledWith('cloud');
});
it('rejects missing server credentials without including credential values', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ''); vi.stubEnv('SUPABASE_SECRET_KEY', 'private');
  expect(() => cloudDb()).toThrow('Missing Cloud database configuration');
});
