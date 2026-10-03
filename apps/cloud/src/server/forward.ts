import { randomUUID } from 'node:crypto';
import type { CloudDb } from './db';
import { getActiveLink, type LinkRecord } from './links';
import { encrypt, decrypt } from './vault';
import type { FetchJson } from './pinned-fetch';

export type ProjectRecord = {
  id: string;
  name: string;
  company: string;
  mcpResource: string;
  asIssuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
};
export class ForwardError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ForwardError'; }
}
type Deps = { db: CloudDb; fetchJson: FetchJson; clientId: string };
const LIMITS = { maxBytes: 262144, timeoutMs: 8000 };
const flights = new Map<string, Promise<string>>();
const unavailable = () => new ForwardError('PROJECT_UNAVAILABLE', 'The project is temporarily unavailable');
const revoked = () => new ForwardError('PROJECT_ACCESS_REVOKED', 'Reconnect the project to restore access');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function cachedToken(link: LinkRecord): string | null {
  if (!link.access_ct || !link.access_expires_at || Date.parse(link.access_expires_at) <= Date.now() + 60000 || !Number.isFinite(Date.parse(link.access_expires_at))) return null;
  return decrypt(link.access_ct, link.key_id);
}
function linkUpdate(db: CloudDb, user: string, projectId: string, values: object, expected: string) {
  return db.from('links').update({ ...values, updated_at: new Date().toISOString() })
    .eq('contour_user', user).eq('project_id', projectId).eq('status', 'active').eq('refresh_ct', expected).select('refresh_ct');
}
async function activeLink(db: CloudDb, user: string, projectId: string) {
  const link = await getActiveLink(db, user, projectId);
  if (!link) throw revoked();
  return link;
}

async function refresh(deps: Deps, user: string, project: ProjectRecord, rejectedAccess?: string): Promise<string> {
  const deadline = Date.now() + LIMITS.timeoutMs;
  // The nonsecret marker claims the ciphertext before calling the rotating AS.
  // Unlike a CAS performed only after refresh, this prevents another process
  // from presenting the same refresh token and triggering reuse revocation.
  for (;;) {
    const link = await activeLink(deps.db, user, project.id);
    const cached = cachedToken(link);
    if (cached && cached !== rejectedAccess) return cached;
    const previousCt = link.refresh_ct;
    if (previousCt.startsWith('refreshing:')) {
      const started = Number(previousCt.split(':')[1]);
      if (!Number.isFinite(started) || Date.now() - started > 30000) {
        await linkUpdate(deps.db, user, project.id, { status: 'needs_reconnect' }, previousCt);
        throw revoked();
      }
      if (Date.now() >= deadline) throw unavailable();
      await new Promise(resolve => setTimeout(resolve, 30));
      continue;
    }
    const refreshToken = decrypt(previousCt, link.key_id);
    const claim = `refreshing:${Date.now()}:${randomUUID()}`;
    const claimed = await linkUpdate(deps.db, user, project.id, { refresh_ct: claim }, previousCt);
    if (claimed.error) throw unavailable();
    if (!claimed.data?.length) {
      if (Date.now() >= deadline) throw unavailable();
      continue;
    }
    let exchanged = false;
    try {
      const response = await deps.fetchJson(project.tokenEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: deps.clientId, resource: project.mcpResource }).toString(), ...LIMITS,
      });
      if (object(response.json) && response.json.error === 'invalid_grant') {
        const marked = await linkUpdate(deps.db, user, project.id, { status: 'needs_reconnect', refresh_ct: previousCt }, claim);
        if (marked.error) throw unavailable();
        // A re-link may have replaced the grant while the old refresh was in flight.
        if (!marked.data?.length) {
          const replacement = cachedToken(await activeLink(deps.db, user, project.id));
          if (replacement) return replacement;
        }
        throw revoked();
      }
      if (response.status !== 200) throw unavailable();
      exchanged = true;
      const token = response.json;
      if (!object(token) || typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' || !token.refresh_token || typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 31536000 || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') throw unavailable();
      const nextRefresh = encrypt(token.refresh_token);
      const nextAccess = encrypt(token.access_token);
      if (nextAccess.keyId !== nextRefresh.keyId) throw unavailable();
      const stored = await linkUpdate(deps.db, user, project.id, {
        refresh_ct: nextRefresh.ct, access_ct: nextAccess.ct, key_id: nextRefresh.keyId,
        access_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      }, claim);
      if (stored.error) throw unavailable();
      if (!stored.data?.length) {
        const latest = cachedToken(await activeLink(deps.db, user, project.id));
        if (latest) return latest;
        throw revoked();
      }
      return token.access_token;
    } catch (error) {
      // Successful rotation without a stored pair cannot safely reuse the old
      // token. Leave the link reconnectable instead of overwriting a newer link.
      await linkUpdate(deps.db, user, project.id, { refresh_ct: previousCt, ...(exchanged ? { status: 'needs_reconnect' } : {}) }, claim);
      if (error instanceof ForwardError) throw error;
      throw unavailable();
    }
  }
}

async function accessToken(deps: Deps, user: string, project: ProjectRecord, rejectedAccess?: string) {
  const link = await activeLink(deps.db, user, project.id);
  const token = cachedToken(link);
  if (token && token !== rejectedAccess) return token;
  const key = JSON.stringify([user, project.id]);
  const pending = flights.get(key);
  if (pending) return pending;
  const flight = refresh(deps, user, project, rejectedAccess);
  flights.set(key, flight);
  try { return await flight; }
  finally { if (flights.get(key) === flight) flights.delete(key); }
}

export async function forwardTool(
  deps: { db: CloudDb; fetchJson: FetchJson; clientId: string },
  p: { contourUser: string; project: ProjectRecord; tool: string; args: Record<string, unknown> },
): Promise<{ result: unknown; isError: boolean }> {
  try {
    let token = await accessToken(deps, p.contourUser, p.project);
    const id = randomUUID();
    const call = () => deps.fetchJson(p.project.mcpResource, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'MCP-Protocol-Version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: p.tool, arguments: p.args } }), ...LIMITS,
    });
    let response = await call();
    if (response.status === 401) {
      token = await accessToken(deps, p.contourUser, p.project, token);
      response = await call();
    }
    if (response.status === 401) {
      const link = await activeLink(deps.db, p.contourUser, p.project.id);
      if (link.access_ct && decrypt(link.access_ct, link.key_id) === token) {
        const marked = await linkUpdate(deps.db, p.contourUser, p.project.id, { status: 'needs_reconnect' }, link.refresh_ct);
        if (marked.error) throw unavailable();
      }
      throw revoked();
    }
    const rpc = response.json;
    if (response.status === 403 && object(rpc) && object(rpc.error) && object(rpc.error.data) && rpc.error.data.code === 'AGENT_ACCESS_DISABLED') throw new ForwardError('AGENT_ACCESS_DISABLED', 'Agent access is disabled for this project');
    if (response.status < 200 || response.status >= 300 || !object(rpc) || !object(rpc.result)) throw unavailable();
    const result = rpc.result;
    let data = result.structuredContent;
    if (data === undefined || data === null) {
      if (!Array.isArray(result.content) || !object(result.content[0]) || typeof result.content[0].text !== 'string') throw unavailable();
      data = JSON.parse(result.content[0].text);
    }
    return { result: data, isError: result.isError === true };
  } catch (error) {
    if (error instanceof ForwardError) throw error;
    throw unavailable();
  }
}
