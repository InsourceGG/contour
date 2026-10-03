import "server-only";
import type { CloudDb } from './db';
import { cloudDb } from './db';
import type { ProjectRecord } from './forward';
import { pinnedFetchJson, type FetchJson } from './pinned-fetch';

export class ProjectClientError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ProjectClientError'; }
}

export function cloudClientDocument(appUrl: string) {
  const origin = appUrl.replace(/\/$/, '');
  return {
    client_id: `${origin}/oauth/client.json`, client_name: 'Contour Cloud',
    redirect_uris: [`${origin}/link/callback`],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

const registrations = new Map<string, Promise<string>>();
type ClientDeps = { db: CloudDb; fetchJson: FetchJson; appUrl: string; mode?: string };
const unavailable = () => new ProjectClientError('PROJECT_UNAVAILABLE', 'Unable to connect to this project. Try again later.');

/** DCR is only for deployments whose CIMD URL cannot be fetched by a project. */
export async function clientIdFor(project: ProjectRecord, overrides?: ClientDeps): Promise<string> {
  const appUrl = overrides?.appUrl ?? process.env.APP_URL ?? 'http://localhost:3100';
  const mode = overrides?.mode ?? process.env.CLOUD_CLIENT_MODE ?? 'cimd';
  if (mode !== 'dcr') return cloudClientDocument(appUrl).client_id;
  if (project.dcrClientId) return project.dcrClientId;
  const db = overrides?.db ?? cloudDb();
  const fetchJson = overrides?.fetchJson ?? pinnedFetchJson;
  const key = `${appUrl}:${project.id}`;
  const existing = registrations.get(key);
  if (existing) return existing;
  const flight = (async () => {
    // Read again inside the flight; another instance may already have registered.
    const { data: current, error } = await db.from('projects').select('dcr_client_id,registration_endpoint')
      .eq('id', project.id).eq('status', 'verified').maybeSingle();
    if (error || !current) throw unavailable();
    if (current.dcr_client_id) return current.dcr_client_id as string;
    const endpoint = current.registration_endpoint ?? project.registrationEndpoint;
    if (!endpoint) throw unavailable();
    let response: Awaited<ReturnType<FetchJson>>;
    try {
      const { client_id: _clientId, ...document } = cloudClientDocument(appUrl);
      void _clientId;
      response = await fetchJson(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(document), maxBytes: 262144, timeoutMs: 8000,
      });
    } catch { throw unavailable(); }
    const json = response.json as Record<string, unknown> | null;
    if (response.status !== 201 || !json || typeof json.client_id !== 'string' || !json.client_id.length ||
      (json.token_endpoint_auth_method !== undefined && json.token_endpoint_auth_method !== 'none') ||
      json.client_secret !== undefined || !Array.isArray(json.redirect_uris) ||
      json.redirect_uris.length !== 1 || json.redirect_uris[0] !== `${appUrl.replace(/\/$/, '')}/link/callback`) throw unavailable();
    // Across processes, only the first persisted client wins. Every caller uses it.
    const written = await db.from('projects').update({ dcr_client_id: json.client_id })
      .eq('id', project.id).eq('status', 'verified').is('dcr_client_id', null).select('dcr_client_id').maybeSingle();
    if (written.error) throw unavailable();
    if (written.data?.dcr_client_id) return written.data.dcr_client_id as string;
    const winner = await db.from('projects').select('dcr_client_id').eq('id', project.id).eq('status', 'verified').maybeSingle();
    if (winner.error || !winner.data?.dcr_client_id) throw unavailable();
    return winner.data.dcr_client_id as string;
  })();
  registrations.set(key, flight);
  try { return await flight; } finally { if (registrations.get(key) === flight) registrations.delete(key); }
}
