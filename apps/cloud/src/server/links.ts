import "server-only";
import { createHash, randomBytes } from 'node:crypto';
import type { CloudDb } from './db';
import { decrypt, encrypt } from './vault';

export type LinkRecord = {
  contour_user: string;
  project_id: string;
  status: 'active' | 'needs_reconnect' | 'revoked';
  scopes: string[];
  refresh_ct: string;
  access_ct: string | null;
  access_expires_at: string | null;
  key_id: string;
  subject_hint: string | null;
  created_at: string;
  updated_at: string;
};
export type LinkSummary = {
  projectId: string;
  name: string;
  company: string;
  surfaces: string[];
  status: LinkRecord['status'];
};

export class LinkError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'LinkError'; }
}

// PostgREST errors and transport exceptions can contain response bodies; keep them private.
async function query<T>(operation: () => PromiseLike<{ data?: T; error?: unknown }>, message: string): Promise<T | undefined> {
  try {
    const response = await operation();
    if (response.error) throw new Error('Database operation failed');
    return response.data;
  } catch {
    throw new LinkError('DB_ERROR', message);
  }
}

export async function createLinkState(db: CloudDb, p: { contourUser: string; projectId: string; sessionId?: string }): Promise<{ state: string; verifier: string; challenge: string }> {
  if (p.sessionId !== undefined && !p.sessionId) throw new LinkError('INVALID_STATE', 'An active session is required');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const sealed = encrypt(verifier);
  await query(() => db.from('link_states').insert({
    state_hash: createHash('sha256').update(state).digest('hex'),
    contour_user: p.contourUser,
    session_id: p.sessionId ?? null,
    project_id: p.projectId,
    verifier_ct: sealed.ct,
    key_id: sealed.keyId,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  }), 'Unable to create link state');
  return { state, verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export async function consumeLinkState(db: CloudDb, p: { state: string; contourUser: string; sessionId?: string }): Promise<{ projectId: string; verifier: string }> {
  const data = await query<{ project_id: string; verifier_ct: string; key_id: string }[]>(() => db.rpc(p.sessionId === undefined ? 'consume_link_state' : 'consume_session_link_state', {
    p_state_hash: createHash('sha256').update(p.state).digest('hex'),
    p_contour_user: p.contourUser,
    ...(p.sessionId === undefined ? {} : { p_session_id: p.sessionId }),
  }), 'Unable to consume link state');
  const row = data?.[0];
  if (!row) throw new LinkError('INVALID_STATE', 'Invalid or expired link state');
  try { return { projectId: row.project_id, verifier: decrypt(row.verifier_ct, row.key_id) }; }
  catch { throw new LinkError('INVALID_STATE', 'Invalid or expired link state'); }
}

export async function upsertLink(db: CloudDb, p: { contourUser: string; projectId: string; refreshToken: string; accessToken?: string; accessExpiresAt?: string; scopes: string[]; subjectHint?: string | null }): Promise<void> {
  if (p.scopes.some(scope => !['view:read', 'data:read', 'view:propose'].includes(scope))) {
    throw new LinkError('INVALID_SCOPE', 'Unsupported project grant scope');
  }
  const refresh = encrypt(p.refreshToken);
  const access = p.accessToken === undefined ? null : encrypt(p.accessToken);
  // A single row key ID protects both tokens, including when configuration rotates mid-call.
  if (access && access.keyId !== refresh.keyId) throw new LinkError('VAULT_ERROR', 'Unable to store project grant');
  await query(() => db.from('links').upsert({
    contour_user: p.contourUser, project_id: p.projectId, status: 'active', scopes: p.scopes,
    refresh_ct: refresh.ct, access_ct: access?.ct ?? null,
    access_expires_at: access ? p.accessExpiresAt ?? null : null,
    key_id: refresh.keyId, subject_hint: p.subjectHint ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: 'contour_user,project_id' }), 'Unable to store project grant');
}

export async function getActiveLink(db: CloudDb, contourUser: string, projectId: string): Promise<LinkRecord | null> {
  const data = await query<LinkRecord | null>(() => db.from('links').select('*')
    .eq('contour_user', contourUser).eq('project_id', projectId).eq('status', 'active').maybeSingle(), 'Unable to read project link');
  return data ?? null;
}

export async function listLinks(db: CloudDb, contourUser: string): Promise<LinkSummary[]> {
  const data = await query<{ project_id: string; status: LinkRecord['status']; projects: { name: string; company: string; surfaces: string[] } | null }[]>(() => db.from('links')
    .select('project_id,status,projects(name,company,surfaces)').eq('contour_user', contourUser).order('created_at', { ascending: true }), 'Unable to list project links');
  return (data ?? []).filter(row => row.projects !== null).map(row => ({
    projectId: row.project_id, name: row.projects!.name, company: row.projects!.company,
    surfaces: row.projects!.surfaces, status: row.status,
  }));
}

export async function markLink(db: CloudDb, contourUser: string, projectId: string, status: 'active' | 'needs_reconnect' | 'revoked'): Promise<void> {
  await query(() => db.from('links').update({ status, updated_at: new Date().toISOString() })
    .eq('contour_user', contourUser).eq('project_id', projectId), 'Unable to update project link');
}

export async function deleteLink(db: CloudDb, contourUser: string, projectId: string): Promise<void> {
  await query(() => db.from('links').delete().eq('contour_user', contourUser).eq('project_id', projectId), 'Unable to delete project link');
}
