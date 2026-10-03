import { z } from 'zod';
import { authenticate, createSession } from '@/lib/session';
import { goTo, isSameOrigin } from '../../_shared';
// A bounded, per-process guard for the standalone demo. A shared store is needed for multi-instance production.
const attempts = new Map<string, { count: number; until: number }>();
const credentials = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) });
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response('This sign-in request is not allowed.', { status: 403 });
  if (Number(request.headers.get('content-length') || 0) > 4096) return new Response('Request too large.', { status: 413 });
  const form = await request.formData();
  const parsed = credentials.safeParse(Object.fromEntries(form));
  if (!parsed.success) return goTo(request, '/login?error=credentials');
  const key = parsed.data.email.toLowerCase();
  const now = Date.now();
  for (const [address, entry] of attempts) if (entry.until <= now) attempts.delete(address);
  if (attempts.size > 1000) attempts.clear();
  const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  if (attempt.count >= 10) return goTo(request, '/login?error=limited');
  attempts.set(key, { ...attempt, count: attempt.count + 1 });
  try {
    const session = await authenticate(parsed.data.email, parsed.data.password);
    if (!session) return goTo(request, '/login?error=credentials');
    await createSession(session);
    attempts.delete(key);
    return goTo(request, '/desk');
  } catch {
    return goTo(request, '/login?error=unavailable');
  }
}
