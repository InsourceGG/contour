import { getSession } from '@/lib/session';
import { saveUserSettings } from '@/data/settings';
import { goTo, isSameOrigin } from '../_shared';
import { z } from 'zod';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response('This request is not allowed.', { status: 403 });
  const session = await getSession();
  if (!session) return goTo(request, '/login');
  const form = await request.formData();
  const name = z.string().trim().min(2).max(80).safeParse(form.get('displayName'));
  if (!name.success) return goTo(request, '/settings?error=name');
  try {
    await saveUserSettings(session, { displayName: name.data, emailNotifications: form.get('emailNotifications') === 'on', slaNotifications: form.get('slaNotifications') === 'on', dailyDigest: form.get('dailyDigest') === 'on' });
    return goTo(request, '/settings?saved=1');
  } catch { return goTo(request, '/settings?error=save'); }
}
