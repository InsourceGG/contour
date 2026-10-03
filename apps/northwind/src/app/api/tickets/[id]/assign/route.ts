import { getSession } from '@/lib/session';
import { assignTicket } from '@/data/tickets';
import { actionResult, isSameOrigin } from '../../../_shared';
import { z } from 'zod';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return actionResult(request, { error: 'This request is not allowed.' }, 403);
  const session = await getSession();
  if (!session) return actionResult(request, { error: 'Your session has ended. Sign in again.' }, 401);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return actionResult(request, { error: 'Ticket not found.' }, 404);
  try {
    await assignTicket(session, id);
    return actionResult(request, { message: 'Ticket assigned to you.' });
  } catch (error) {
    const missing = error instanceof Error && error.message === 'Ticket not found.';
    return actionResult(request, { error: missing ? 'Ticket not found in your team.' : 'Unable to assign this ticket. Try again.' }, missing ? 404 : 500);
  }
}
