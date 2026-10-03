import "server-only";
import { z } from 'zod';
import type { CloudDb } from './db';
import type { ProjectRecord } from './forward';
import { consumeLinkState, createLinkState, upsertLink } from './links';
import { clientIdFor } from './project-client';
import { pinnedFetchJson, type FetchJson } from './pinned-fetch';

export class LinkFlowError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'LinkFlowError'; }
}
export type LinkProject = ProjectRecord & { authorizationEndpoint: string; description: string };
type Deps = { db: CloudDb; appUrl: string; fetchJson?: FetchJson; clientIdFor?: (project: ProjectRecord) => Promise<string> };
export const PROJECT_SCOPES = ['view:read', 'data:read', 'view:propose'] as const;

export async function linkProject(db: CloudDb, id: string): Promise<LinkProject | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await db.from('projects')
    .select('id,name,company,description,mcp_resource,as_issuer,token_endpoint,authorization_endpoint,revocation_endpoint,registration_endpoint,dcr_client_id')
    .eq('id', id).eq('status', 'verified').maybeSingle();
  if (error) throw new LinkFlowError('PROJECT_UNAVAILABLE', 'Unable to load this project. Try again later.');
  if (!data) return null;
  return { id: data.id, name: data.name, company: data.company, description: data.description,
    mcpResource: data.mcp_resource, asIssuer: data.as_issuer, tokenEndpoint: data.token_endpoint,
    authorizationEndpoint: data.authorization_endpoint, revocationEndpoint: data.revocation_endpoint,
    registrationEndpoint: data.registration_endpoint, dcrClientId: data.dcr_client_id };
}

async function requireProject(db: CloudDb, id: string) {
  const project = await linkProject(db, id);
  if (!project) throw new LinkFlowError('NOT_FOUND', 'This project is not available for linking.');
  return project;
}

export async function beginLink(deps: Deps, user: string, projectId: string, sessionId?: string): Promise<string> {
  const project = await requireProject(deps.db, projectId);
  const clientId = await (deps.clientIdFor ?? clientIdFor)(project);
  const state = await createLinkState(deps.db, { contourUser: user, projectId, sessionId });
  const authorize = new URL(project.authorizationEndpoint);
  const params = { response_type: 'code', client_id: clientId, redirect_uri: `${deps.appUrl}/link/callback`,
    code_challenge: state.challenge, code_challenge_method: 'S256', state: state.state,
    resource: project.mcpResource, scope: PROJECT_SCOPES.join(' ') };
  for (const [key, value] of Object.entries(params)) authorize.searchParams.set(key, value);
  return authorize.toString();
}

/** State is consumed before all callback outcomes, including denied consent. */
export async function finishLink(deps: Deps, user: string, url: URL, sessionId?: string): Promise<string> {
  const state = url.searchParams.get('state');
  if (!state || state.length > 256) throw new LinkFlowError('INVALID_STATE', 'This link has expired or was already used. Start again from Projects.');
  const consumed = await consumeLinkState(deps.db, { state, contourUser: user, sessionId });
  const project = await requireProject(deps.db, consumed.projectId);
  const issuer = url.searchParams.get('iss');
  if (issuer !== null && issuer !== project.asIssuer) throw new LinkFlowError('ISSUER_MISMATCH', 'The company response could not be verified. Start linking again.');
  if (url.searchParams.get('error') === 'access_denied') return `/projects?declined=${project.id}`;
  const code = url.searchParams.get('code');
  if (url.searchParams.has('error') || !code || code.length > 4096) throw new LinkFlowError('LINK_FAILED', 'The company could not complete this link. Start again from Projects.');
  const clientId = await (deps.clientIdFor ?? clientIdFor)(project);
  let response: Awaited<ReturnType<FetchJson>>;
  try {
    response = await (deps.fetchJson ?? pinnedFetchJson)(project.tokenEndpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId,
        redirect_uri: `${deps.appUrl}/link/callback`, code_verifier: consumed.verifier, resource: project.mcpResource }).toString(),
      maxBytes: 262144, timeoutMs: 8000,
    });
  } catch { throw new LinkFlowError('PROJECT_UNAVAILABLE', 'The company could not complete this link. Start again from Projects.'); }
  const parsed = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1),
    token_type: z.string().refine(value => value.toLowerCase() === 'bearer'),
    expires_in: z.number().int().positive().max(31_536_000), scope: z.string().optional() }).safeParse(response.json);
  if (response.status !== 200 || !parsed.success) throw new LinkFlowError('LINK_FAILED', 'The company could not complete this link. Start again from Projects.');
  const scopes = parsed.data.scope?.split(/\s+/).filter(Boolean) ?? [...PROJECT_SCOPES];
  if (scopes.some(scope => !(PROJECT_SCOPES as readonly string[]).includes(scope)) || !scopes.includes('view:read')) {
    throw new LinkFlowError('INVALID_SCOPE', 'The company returned unsupported permissions. Start linking again.');
  }
  await upsertLink(deps.db, { contourUser: user, projectId: project.id, refreshToken: parsed.data.refresh_token,
    accessToken: parsed.data.access_token, accessExpiresAt: new Date(Date.now() + parsed.data.expires_in * 1000).toISOString(), scopes });
  const audit = await deps.db.from('audit_events').insert({ contour_user: user, project_id: project.id, kind: 'project_linked', detail: {} });
  if (audit.error) throw new LinkFlowError('DB_ERROR', 'The project is linked, but its activity could not be recorded. Return to Projects.');
  return `/projects?linked=${project.id}`;
}
