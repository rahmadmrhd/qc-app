import { beforeEach, describe, expect, test } from 'bun:test';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

let env: TestEnv;

const VIEWER = 'cl-view@gmail.com';
const EDITOR = 'cl-edit@gmail.com';
const MANAGER = 'cl-manage@gmail.com';

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-28T00:00:00.000Z'));
  await seedRole(env, { id: 'r-v', name: 'CL view', permissions: { countrylock: 'view' } });
  await seedRole(env, { id: 'r-e', name: 'CL edit', permissions: { countrylock: 'edit' } });
  await seedRole(env, { id: 'r-m', name: 'CL manage', permissions: { countrylock: 'manage' } });
  await seedUser(env, { id: 'u-v', email: VIEWER, roleIds: ['r-v'] });
  await seedUser(env, { id: 'u-e', email: EDITOR, roleIds: ['r-e'] });
  await seedUser(env, { id: 'u-m', email: MANAGER, roleIds: ['r-m'] });
});

const SAVE = { path: 'mikrotik/AC.rsc', role: 'script', text: ':put {ipTarget}' };

describe('clFiles.*', () => {
  test('countrylock: view ditolak FORBIDDEN pada semua rute clFiles', async () => {
    const inputs: Array<[string, unknown]> = [
      ['clFiles.list', null],
      ['clFiles.get', { id: 'x' }],
      ['clFiles.save', SAVE],
      ['clFiles.remove', { id: 'x' }],
      ['clFiles.history', { id: 'x' }],
      ['clFiles.revision', { id: 'x', seq: '1' }],
      ['clFiles.revert', { id: 'x', seq: 1 }],
    ];
    for (const [id, input] of inputs) {
      const result = await call(VIEWER, id, input);
      expect(result.ok, id).toBe(false);
      expect(result.error?.code, id).toBe('FORBIDDEN');
    }
  });

  test('edit dan manage boleh; alur simpan, daftar, riwayat, revisi, revert, hapus', async () => {
    const saved = await call(EDITOR, 'clFiles.save', SAVE);
    expect(saved.ok).toBe(true);
    const id = saved.data.id as string;
    const listed = await call(MANAGER, 'clFiles.list', null);
    expect(listed.data.map((row: Json) => row.path)).toEqual(['mikrotik/AC.rsc']);
    const second = await call(EDITOR, 'clFiles.save', {
      ...SAVE,
      text: ':put 2',
      baseSeq: 1,
      expectedUpdatedAt: saved.data.updatedAt,
    });
    expect(second.data.headRev).toBe(2);
    expect((await call(EDITOR, 'clFiles.history', { id })).data).toHaveLength(2);
    expect((await call(EDITOR, 'clFiles.revision', { id, seq: '1' })).data.text).toBe(SAVE.text);
    const reverted = await call(EDITOR, 'clFiles.revert', { id, seq: 1 });
    expect(reverted.data.headRev).toBe(3);
    expect((await call(EDITOR, 'clFiles.get', { id })).data.text).toBe(SAVE.text);
    expect((await call(EDITOR, 'clFiles.remove', { id })).ok).toBe(true);
    expect((await call(EDITOR, 'clFiles.list', null)).data).toEqual([]);
  });

  test('If-Match basi pada clFiles.save = 412 di kabel; tanpa If-Match yang basi = 409', async () => {
    const saved = await call(EDITOR, 'clFiles.save', SAVE);
    env.clock.set(Date.parse('2026-11-28T00:30:00.000Z')); // updatedAt berubah pada simpan kedua
    await call(EDITOR, 'clFiles.save', { ...SAVE, text: 'dua', baseSeq: 1 });
    const rest = restClient(env);
    const body = { ...SAVE, text: 'tiga', baseSeq: 2 };
    const stale = await rest.put('/countrylock/files', {
      email: EDITOR,
      body,
      headers: { 'if-match': `"${saved.data.updatedAt}"` },
    });
    expect(stale.status).toBe(412);
    expect((await jsonOf(stale)).code).toBe('CONFLICT');
    const staleBase = await rest.put('/countrylock/files', {
      email: EDITOR,
      body: { ...body, baseSeq: 1 },
    });
    expect(staleBase.status).toBe(409);
  });
});
