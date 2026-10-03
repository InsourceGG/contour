import { z } from 'zod';
import { ContourError } from '@contour/sdk/core';
import { adminMutation } from '@/contour/admin-access';
import { setAgentAccess } from '@/contour/identity';
const input = z.strictObject({ enabled: z.boolean() });
/** Admin kill switch. enabled false turns the kill switch on and disables agent access. */
export async function POST(request: Request) {
  return adminMutation(request, async (admin, body) => {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new ContourError('INVALID_INPUT', 'Expected { enabled: boolean }');
    await setAgentAccess(parsed.data.enabled, admin.subjectId);
    return { enabled: parsed.data.enabled };
  });
}
