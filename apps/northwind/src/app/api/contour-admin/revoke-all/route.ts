import { z } from 'zod';
import { ContourError } from '@contour/sdk/core';
import { adminMutation } from '@/contour/admin-access';
import { APP_ID, TENANT_ID } from '@/contour/identity';
import { contour } from '@/contour/server';
const input = z.strictObject({});
/** Admin: disconnect every agent connected to Northwind, revoking their grants and tokens. */
export async function POST(request: Request) {
  return adminMutation(request, async (admin, body) => {
    if (!input.safeParse(body).success) throw new ContourError('INVALID_INPUT', 'Expected an empty JSON object');
    return { revoked: await contour.oauth.revokeAllGrantsForApp(TENANT_ID, APP_ID, admin.subjectId) };
  });
}
