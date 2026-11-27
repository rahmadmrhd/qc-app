import { beforeEach, describe, expect, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  clFileHistory,
  getClFile,
  getClRevision,
  listClFiles,
  removeClFile,
  revertClFile,
  saveClFile,
} from './files-service';
import { validateSaveClFile } from './validate';

let env: TestEnv;
const ACTOR = { email: 'admin@gmail.com' };
const OTHER = { email: 'lain@gmail.com' };

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-28T00:00:00.000Z'));
});

const save = async (input: Record<string, unknown>, actor = ACTOR) =>
  saveClFile(env, validateSaveClFile({ role: 'script', text: 'a', ...input }), actor);

type Failure = { code?: string; stale?: boolean; message: string };

async function errorOf(promise: Promise<unknown>): Promise<Failure> {
  return promise.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (error: Failure) => error,
  );
}

async function auditActions(): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{
    action: string;
  }>();
  return rows.results.map((row) => row.action);
}

describe('saveClFile', () => {
  test('simpan pertama = revisi 1, simpan teks beda = revisi 2 dengan riwayat berurut', async () => {
    const first = await save({ path: 'mikrotik/AC.rsc', text: 'satu', message: 'awal' });
    expect(first.headRev).toBe(1);
    expect(first.text).toBe('satu');
    expect(first.kind).toBe('text');
    expect(first.removed).toBe(false);
    env.clock.set(Date.parse('2026-11-28T01:00:00.000Z'));
    const second = await save({
      path: 'mikrotik/AC.rsc',
      text: 'dua',
      baseSeq: 1,
      expectedUpdatedAt: first.updatedAt,
      message: 'ubah',
    });
    expect(second.headRev).toBe(2);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(second.updatedBy).toBe('admin@gmail.com');
    const history = await clFileHistory(env, { id: first.id });
    expect(history.map((row) => row.seq)).toEqual([2, 1]);
    expect(history.map((row) => row.message)).toEqual(['ubah', 'awal']);
    expect(history[0]?.sha256).not.toBe(history[1]?.sha256);
    expect(await auditActions()).toEqual(['countrylock.file_save', 'countrylock.file_save']);
  });

  test('teks sama dengan revisi terbaru = no-op (tanpa revisi baru dan tanpa audit)', async () => {
    const first = await save({ path: 's.rsc', text: 'sama' });
    const again = await save({
      path: 's.rsc',
      text: 'sama',
      baseSeq: 1,
      expectedUpdatedAt: first.updatedAt,
    });
    expect(again.headRev).toBe(1);
    expect(again.updatedAt).toBe(first.updatedAt);
    expect(await clFileHistory(env, { id: first.id })).toHaveLength(1);
    expect(await auditActions()).toEqual(['countrylock.file_save']);
  });

  test('dua save serentak dari baseSeq sama: tepat satu sukses, satu basi (bukan menimpa)', async () => {
    const first = await save({ path: 'r.rsc', text: 'awal' });
    const attempts = await Promise.allSettled([
      save({ path: 'r.rsc', text: 'admin A', baseSeq: 1 }, ACTOR),
      save({ path: 'r.rsc', text: 'admin B', baseSeq: 1 }, OTHER),
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((a) => a.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('CONFLICT');
    expect(rejected.reason.stale).toBe(true);
    const history = await clFileHistory(env, { id: first.id });
    expect(history.map((row) => row.seq)).toEqual([2, 1]);
    expect((await getClFile(env, { id: first.id })).headRev).toBe(2);
  });

  test('baseSeq atau expectedUpdatedAt basi ditolak, berkas yang ada wajib membawa baseSeq', async () => {
    const first = await save({ path: 'b.rsc', text: 'satu' });
    env.clock.set(Date.parse('2026-11-28T00:30:00.000Z')); // updatedAt berubah pada simpan kedua
    await save({ path: 'b.rsc', text: 'dua', baseSeq: 1 });
    const staleSeq = await errorOf(save({ path: 'b.rsc', text: 'tiga', baseSeq: 1 }));
    expect(staleSeq).toMatchObject({ code: 'CONFLICT', stale: true });
    const staleStamp = await errorOf(
      save({ path: 'b.rsc', text: 'tiga', baseSeq: 2, expectedUpdatedAt: first.updatedAt }),
    );
    expect(staleStamp).toMatchObject({ code: 'CONFLICT', stale: true });
    const noBase = await errorOf(save({ path: 'b.rsc', text: 'tiga' }));
    expect(noBase.code).toBe('CONFLICT');
    expect(await clFileHistory(env, { id: first.id })).toHaveLength(2);
  });

  test('path beda huruf besar/kecil dari berkas hidup = CONFLICT (A.rsc lalu a.rsc)', async () => {
    await save({ path: 'A.rsc' });
    const clash = await errorOf(save({ path: 'a.rsc', text: 'lain' }));
    expect(clash.code).toBe('CONFLICT');
    expect((await listClFiles(env)).map((row) => row.path)).toEqual(['A.rsc']);
  });

  test('pembuatan serentak path yang sama: satu sukses, satu CONFLICT', async () => {
    const attempts = await Promise.allSettled([
      save({ path: 'dup.rsc', text: 'A' }, ACTOR),
      save({ path: 'dup.rsc', text: 'B' }, OTHER),
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((a) => a.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('CONFLICT');
    expect(await listClFiles(env)).toHaveLength(1);
  });

  test('path jahat atau teks terlalu besar = VALIDATION', async () => {
    for (const path of ['/abs', 'a/../b', 'a\\b', 'a//b', 'a\u0000b', '']) {
      const error = await errorOf(save({ path }));
      expect(error.code, path).toBe('VALIDATION');
    }
    const huge = 'x'.repeat(200 * 1024 + 1);
    expect((await errorOf(save({ path: 'big.rsc', text: huge }))).code).toBe('VALIDATION');
    const wide = 'é'.repeat(100 * 1024 + 1); // 2 byte per karakter: melewati batas byte
    expect((await errorOf(save({ path: 'wide.rsc', text: wide }))).code).toBe('VALIDATION');
    const exact = 'x'.repeat(200 * 1024);
    expect((await save({ path: 'big.rsc', text: exact })).headRev).toBe(1);
  });

  test('settings.json: hanya role settings dan isinya harus sah', async () => {
    const broken = await errorOf(save({ path: 'settings.json', role: 'settings', text: '{rusak' }));
    expect(broken.code).toBe('VALIDATION');
    const wrongRole = await errorOf(save({ path: 'settings.json', role: 'script', text: '{}' }));
    expect(wrongRole.code).toBe('VALIDATION');
    const wrongPath = await errorOf(save({ path: 'lain.json', role: 'settings', text: '{}' }));
    expect(wrongPath.code).toBe('VALIDATION');
  });

  test('remove lalu simpan path sama membuat berkas baru (id beda), revisi lama tetap', async () => {
    const first = await save({ path: 'x.rsc', text: 'lama' });
    await removeClFile(env, { id: first.id }, ACTOR);
    expect(await listClFiles(env)).toEqual([]);
    env.clock.set(Date.parse('2026-11-28T02:00:00.000Z'));
    const fresh = await save({ path: 'x.rsc', text: 'baru' });
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.headRev).toBe(1);
    expect(await clFileHistory(env, { id: first.id })).toHaveLength(1);
    expect((await getClFile(env, { id: first.id })).removed).toBe(true);
    // berkas terhapus tidak dapat dihapus atau dikembalikan lagi
    expect((await errorOf(removeClFile(env, { id: first.id }, ACTOR))).code).toBe('NOT_FOUND');
    expect((await errorOf(revertClFile(env, { id: first.id, seq: 1 }, ACTOR))).code).toBe(
      'NOT_FOUND',
    );
    expect(await auditActions()).toContain('countrylock.file_remove');
  });

  test('revert ke seq 1 membuat revisi baru ber-sha256 sama; riwayat tidak ditulis ulang', async () => {
    const first = await save({ path: 'v.rsc', text: 'satu' });
    await save({ path: 'v.rsc', text: 'dua', baseSeq: 1 });
    const reverted = await revertClFile(env, { id: first.id, seq: 1, message: 'balik' }, ACTOR);
    expect(reverted.headRev).toBe(3);
    expect(reverted.text).toBe('satu');
    const history = await clFileHistory(env, { id: first.id });
    expect(history.map((row) => row.seq)).toEqual([3, 2, 1]);
    expect(history[0]?.sha256).toBe(history[2]?.sha256);
    expect(history[0]?.message).toBe('balik');
    expect((await getClRevision(env, { id: first.id, seq: '2' })).text).toBe('dua');
    // revert ke isi yang sama dengan terbaru = no-op
    const noop = await revertClFile(env, { id: first.id, seq: 3 }, ACTOR);
    expect(noop.headRev).toBe(3);
    expect(await auditActions()).toContain('countrylock.file_revert');
    expect((await errorOf(revertClFile(env, { id: first.id, seq: 99 }, ACTOR))).code).toBe(
      'NOT_FOUND',
    );
  });

  test('getClRevision dan getClFile: tak ada = NOT_FOUND', async () => {
    const first = await save({ path: 'g.rsc', text: 'a' });
    expect((await getClRevision(env, { id: first.id, seq: '1' })).text).toBe('a');
    expect((await errorOf(getClRevision(env, { id: first.id, seq: '7' }))).code).toBe('NOT_FOUND');
    expect((await errorOf(getClFile(env, { id: 'tidak-ada' }))).code).toBe('NOT_FOUND');
  });

  test('daftar berkas hidup urut nama jalur dengan ukuran dan hash terbaru', async () => {
    await save({ path: 'b.rsc', text: 'bb' });
    await save({ path: 'a.rsc', text: 'a' });
    const list = await listClFiles(env);
    expect(list.map((row) => row.path)).toEqual(['a.rsc', 'b.rsc']);
    expect(list.map((row) => row.size)).toEqual([1, 2]);
    expect(list[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
