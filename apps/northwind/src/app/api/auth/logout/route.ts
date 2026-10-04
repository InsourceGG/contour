import { clearSession } from '@/lib/session';
import { goTo, isSameOrigin } from '../../_shared';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response('This sign-out request is not allowed.', { status: 403 });
  await clearSession();
  return goTo(request, '/login');
}
