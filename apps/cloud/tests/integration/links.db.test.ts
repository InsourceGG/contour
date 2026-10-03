import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudDb, type CloudDb } from '../../src/server/db.js';
import { consumeLinkState, createLinkState, getActiveLink, upsertLink } from '../../src/server/links.js';
import { decrypt, encrypt } from '../../src/server/vault.js';

// Opt-in only: unit runs never contact Supabase. Fixtures use existing Auth identity.
describe.skipIf(process.env.CLOUD_DB_TESTS !== '1')('links against real cloud schema', () => {
  let db: CloudDb;
  let contourUser: string;
  const projectId = randomUUID();
  let insertedProject = false;

  beforeAll(async () => {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const listed = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (listed.error || !listed.data.users[0]) throw new Error('DB tests require an existing Auth user fixture');
    contourUser = listed.data.users[0].id;
    db = cloudDb();
    const { error } = await db.from('projects').insert({
      id: projectId, owner_id: contourUser, name: 'Cloud DB test fixture', company: 'Test',
      base_url: 'https://cloud-test.invalid', verify_nonce: randomUUID(), status: 'verified',
      mcp_resource: 'https://cloud-test.invalid/api/mcp', as_issuer: 'https://cloud-test.invalid',
      token_endpoint: 'https://cloud-test.invalid/oauth/token', authorization_endpoint: 'https://cloud-test.invalid/oauth/authorize',
    });
    if (error) throw new Error('Unable to create isolated cloud project fixture');
    insertedProject = true;
  }, 20_000);

  afterAll(async () => {
    if (!insertedProject) return;
    const states = await db.from('link_states').delete().eq('project_id', projectId);
    const projects = await db.from('projects').delete().eq('id', projectId);
    if (states.error || projects.error) throw new Error('Unable to clean up isolated cloud fixtures');
  }, 20_000);

  it('atomically consumes only one concurrent request and rejects replay', async () => {
    const created = await createLinkState(db, { contourUser, projectId });
    const results = await Promise.allSettled([
      consumeLinkState(db, { contourUser, state: created.state }),
      consumeLinkState(db, { contourUser, state: created.state }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const success = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<unknown>;
    expect(success.value).toEqual({ projectId, verifier: created.verifier });
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason.code).toBe('INVALID_STATE');
    await expect(consumeLinkState(db, { contourUser, state: created.state })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects expired states using database time', async () => {
    const created = await createLinkState(db, { contourUser, projectId });
    const { error } = await db.from('link_states').update({ expires_at: '2000-01-01T00:00:00Z' })
      .eq('state_hash', createHash('sha256').update(created.state).digest('hex'));
    expect(error).toBeNull();
    await expect(consumeLinkState(db, { contourUser, state: created.state })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('binds state to the caller without consuming it on another user attempt', async () => {
    const created = await createLinkState(db, { contourUser, projectId });
    await expect(consumeLinkState(db, { contourUser: randomUUID(), state: created.state })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(consumeLinkState(db, { contourUser, state: created.state })).resolves.toEqual({ projectId, verifier: created.verifier });
  });

  it('allows one refresh claimant and persists rotation only against its claim', async () => {
    await upsertLink(db, { contourUser, projectId, refreshToken: 'test-refresh-before', scopes: ['view:read'] });
    const previous = await getActiveLink(db, contourUser, projectId);
    expect(previous).not.toBeNull();
    const claims = [`refreshing:${Date.now()}:${randomUUID()}`, `refreshing:${Date.now()}:${randomUUID()}`];
    const results = await Promise.all(claims.map(marker => db.from('links').update({ refresh_ct: marker })
      .eq('contour_user', contourUser).eq('project_id', projectId).eq('status', 'active')
      .eq('refresh_ct', previous!.refresh_ct).select('refresh_ct')));
    expect(results.every(result => result.error === null)).toBe(true);
    expect(results.map(result => result.data.length).sort()).toEqual([0, 1]);
    const winner = results[0].data.length === 1 ? 0 : 1;
    const rotatedRefresh = encrypt('test-refresh-after');
    const rotatedAccess = encrypt('test-access-after');
    const update = { refresh_ct: rotatedRefresh.ct, access_ct: rotatedAccess.ct, key_id: rotatedRefresh.keyId, access_expires_at: new Date(Date.now() + 3600_000).toISOString() };
    const loserResult = await db.from('links').update(update).eq('contour_user', contourUser).eq('project_id', projectId)
      .eq('refresh_ct', claims[1 - winner]).select('refresh_ct');
    expect(loserResult.error).toBeNull(); expect(loserResult.data).toHaveLength(0);
    const winnerResult = await db.from('links').update(update).eq('contour_user', contourUser).eq('project_id', projectId)
      .eq('refresh_ct', claims[winner]).select('refresh_ct');
    expect(winnerResult.error).toBeNull(); expect(winnerResult.data).toHaveLength(1);
    const row = await getActiveLink(db, contourUser, projectId);
    expect(decrypt(row!.refresh_ct, row!.key_id)).toBe('test-refresh-after');
    expect(decrypt(row!.access_ct!, row!.key_id)).toBe('test-access-after');
  });

  it('enforces the scope cap on direct database inserts and updates', async () => {
    const removed = await db.from('links').delete().eq('contour_user', contourUser).eq('project_id', projectId);
    expect(removed.error).toBeNull();
    const token = encrypt('test-refresh');
    const rejected = await db.from('links').insert({
      contour_user: contourUser, project_id: projectId, status: 'active',
      scopes: ['view:read', 'view:write'], refresh_ct: token.ct, key_id: token.keyId,
    });
    expect(rejected.error).toMatchObject({ code: '23514' });
    expect(await getActiveLink(db, contourUser, projectId)).toBeNull();
    await upsertLink(db, { contourUser, projectId, refreshToken: 'test-refresh',
      scopes: ['view:read', 'data:read', 'view:propose'] });
    const updated = await db.from('links').update({ scopes: ['admin'] })
      .eq('contour_user', contourUser).eq('project_id', projectId);
    expect(updated.error).toMatchObject({ code: '23514' });
    expect((await getActiveLink(db, contourUser, projectId))?.scopes)
      .toEqual(['view:read', 'data:read', 'view:propose']);
  });
});
