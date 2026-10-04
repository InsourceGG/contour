import { env } from '@/server/env';
import { cloudClientDocument } from '@/server/project-client';

export function GET() {
  return Response.json(cloudClientDocument(env.appUrl), { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
}
