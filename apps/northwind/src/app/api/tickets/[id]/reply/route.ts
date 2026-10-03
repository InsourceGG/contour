import { getSession } from '@/lib/session';
import { replyToTicket } from '@/data/tickets';
import { actionResult, isSameOrigin } from '../../../_shared';
import { z } from 'zod';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return actionResult(request, { error: 'This request is not allowed.' }, 403);
  const session = await getSession();
  if (!session) return actionResult(request, { error: 'Your session has ended. Sign in again.' }, 401);
  if (Number(request.headers.get('content-length') || 0) > 40000) return actionResult(request, { error: 'Replies can contain up to 5,000 characters.' }, 413);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return actionResult(request, { error: 'Ticket not found.' }, 404);
  const form = await request.formData();
  const body = z.string().trim().min(1).max(5000).safeParse(form.get('body'));
  if (!body.success) return actionResult(request, { error: 'Write a reply between 1 and 5,000 characters.' }, 400);
  try {
    await replyToTicket(session, id, body.data);
    return actionResult(request, { message: 'Reply saved to the conversation.' });
  } catch (error) {
    const missing = error instanceof Error && error.message === 'Ticket not found.';
    return actionResult(request, { error: missing ? 'Ticket not found in your team.' : 'Unable to save your reply. Try again.' }, missing ? 404 : 500);
  }
}
