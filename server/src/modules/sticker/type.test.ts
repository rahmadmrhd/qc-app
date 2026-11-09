import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { getRoutes } from '@server/routes';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { listStickerTypes, saveStickerType, setStickerTypeStatus } from './service';
import { validateSaveStickerType, validateSetStickerTypeStatus } from './validate';

let env: TestEnv;
let admin: UserContext;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-09T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

async function lastAudit() {
  const row = await env.DB.prepare(
    'SELECT action, target, `before`, `after` FROM audit_log ORDER BY id DESC LIMIT 1',
  ).first<{ action: string; target: string; before: string; after: string }>();
  if (!row) throw new Error('audit kosong');
  return {
    action: row.action,
    target: row.target,
    before: JSON.parse(row.before) as unknown,
    after: JSON.parse(row.after) as unknown,
  };
}

async function insertSticker(typeId: string, name: string) {
  const now = '2026-11-09T00:00:00.000Z';
  await env.DB.prepare(
    'INSERT INTO stickers (id, type_id, name, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(`stk-${name}`, typeId, name, 'active', now, now, 'seed')
    .run();
}

describe('jenis stiker', () => {
  test('membuat jenis: aktif, stickerCount 0, muncul di daftar, audit stickerType.create', async () => {
    const saved = await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
    expect(saved).toMatchObject({
      name: 'QC',
      rule: 'bu',
      status: 'active',
      stickerCount: 0,
      updatedAt: '2026-11-09T00:00:00.000Z',
    });
    expect(await listStickerTypes(env)).toEqual([saved]);
    expect(await lastAudit()).toMatchObject({
      action: 'stickerType.create',
      target: 'QC',
      before: null,
      after: { name: 'QC', rule: 'bu', status: 'active' },
    });
  });

  test('nama kembar (beda huruf/spasi ekor) ditolak dengan pesan generik di field name', async () => {
    await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
    for (const dup of ['qc', 'QC', ' qc ']) {
      const input = validateSaveStickerType({ name: dup, rule: 'none' });
      const error = await captureAppErrorAsync(() => saveStickerType(env, input, admin));
      expect(error.code).toBe('CONFLICT');
      expect(error.fields).toEqual({ name: 'Nama jenis sudah dipakai' });
    }
    expect(await listStickerTypes(env)).toHaveLength(1);
  });

  test('mengganti nama sendiri ke nama yang sama berbeda huruf diperbolehkan; ke nama jenis lain ditolak', async () => {
    const qc = await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
    await saveStickerType(env, { name: 'Gudang', rule: 'none' }, admin);
    const renamed = await saveStickerType(env, { id: qc.id, name: 'qc', rule: 'bu' }, admin);
    expect(renamed.name).toBe('qc');
    expect(await lastAudit()).toMatchObject({
      action: 'stickerType.update',
      before: { name: 'QC' },
      after: { name: 'qc' },
    });
    const error = await captureAppErrorAsync(() =>
      saveStickerType(env, { id: qc.id, name: 'gudang', rule: 'bu' }, admin),
    );
    expect(error.fields).toEqual({ name: 'Nama jenis sudah dipakai' });
  });

  test('id tidak dikenal pada ubah -> NOT_FOUND', async () => {
    const error = await captureAppErrorAsync(() =>
      saveStickerType(env, { id: 'tidak-ada', name: 'X', rule: 'bu' }, admin),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  test('rule tidak dikenal (mis. group) ditolak VALIDATION oleh validator', () => {
    const error = captureAppError(() => validateSaveStickerType({ name: 'X', rule: 'group' }));
    expect(error.code).toBe('VALIDATION');
    expect(error.fields).toMatchObject({ rule: 'Nilai tidak valid' });
    expect(captureAppError(() => validateSaveStickerType({ name: '  ', rule: 'bu' })).code).toBe(
      'VALIDATION',
    );
    expect(
      captureAppError(() => validateSaveStickerType({ name: 'x'.repeat(121), rule: 'bu' })).code,
    ).toBe('VALIDATION');
  });

  test('rule tidak dapat diubah bila sudah ada stiker; tanpa stiker boleh; sama tetap boleh', async () => {
    const type = await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
    const changed = await saveStickerType(env, { id: type.id, name: 'QC', rule: 'none' }, admin);
    expect(changed.rule).toBe('none');
    await insertSticker(type.id, 'Hijau');
    const error = await captureAppErrorAsync(() =>
      saveStickerType(env, { id: type.id, name: 'QC', rule: 'bu' }, admin),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fields).toEqual({
      rule: 'Aturan jenis tidak dapat diubah karena sudah ada stiker',
    });
    const row = await env.DB.prepare('SELECT rule FROM sticker_types WHERE id = ?')
      .bind(type.id)
      .first<{ rule: string }>();
    expect(row?.rule).toBe('none');
    // aturan sama + ganti nama tetap boleh
    const renamed = await saveStickerType(
      env,
      { id: type.id, name: 'QC Baru', rule: 'none' },
      admin,
    );
    expect(renamed).toMatchObject({ name: 'QC Baru', rule: 'none', stickerCount: 1 });
  });

  test('stickerCount menghitung stiker aktif maupun nonaktif milik jenis itu saja', async () => {
    const a = await saveStickerType(env, { name: 'A', rule: 'bu' }, admin);
    const b = await saveStickerType(env, { name: 'B', rule: 'bu' }, admin);
    await insertSticker(a.id, 'a1');
    await insertSticker(a.id, 'a2');
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = 'stk-a2'").run();
    const list = await listStickerTypes(env);
    expect(list.map((t) => [t.name, t.stickerCount])).toEqual([
      ['A', 2],
      ['B', 0],
    ]);
    expect(b.stickerCount).toBe(0);
  });

  test('menonaktifkan lalu mengaktifkan kembali; audit stickerType.status; idempoten', async () => {
    const type = await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
    env.clock.set(Date.parse('2026-11-09T01:00:00.000Z'));
    const off = await setStickerTypeStatus(env, { id: type.id, status: 'inactive' }, admin);
    expect(off).toMatchObject({ status: 'inactive', updatedAt: '2026-11-09T01:00:00.000Z' });
    expect(await lastAudit()).toMatchObject({
      action: 'stickerType.status',
      target: 'QC',
      before: { status: 'active' },
      after: { status: 'inactive' },
    });
    const on = await setStickerTypeStatus(env, { id: type.id, status: 'active' }, admin);
    expect(on.status).toBe('active');
    const auditsBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{
      n: number;
    }>();
    const again = await setStickerTypeStatus(env, { id: type.id, status: 'active' }, admin);
    expect(again.status).toBe('active');
    const auditsAfter = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{
      n: number;
    }>();
    expect(Number(auditsAfter?.n)).toBe(Number(auditsBefore?.n));
    const missing = await captureAppErrorAsync(() =>
      setStickerTypeStatus(env, { id: 'tidak-ada', status: 'inactive' }, admin),
    );
    expect(missing.code).toBe('NOT_FOUND');
  });

  test('validator status', () => {
    expect(validateSetStickerTypeStatus({ id: 'x', status: 'inactive' })).toEqual({
      id: 'x',
      status: 'inactive',
    });
    expect(captureAppError(() => validateSetStickerTypeStatus({ id: 'x', status: 'y' })).code).toBe(
      'VALIDATION',
    );
  });

  test('izin rute: list=view, save=edit, setStatus=manage (modul sticker, global)', () => {
    const routes = getRoutes();
    expect(routes['stickerTypes.list'].permission).toEqual({ module: 'sticker', level: 'view' });
    expect(routes['stickerTypes.save'].permission).toEqual({ module: 'sticker', level: 'edit' });
    expect(routes['stickerTypes.setStatus'].permission).toEqual({
      module: 'sticker',
      level: 'manage',
    });
  });

  test('dua pembuatan serentak dengan nama sama: satu CONFLICT, satu tersimpan', async () => {
    const results = await Promise.allSettled([
      saveStickerType(env, { name: 'QC', rule: 'bu' }, admin),
      saveStickerType(env, { name: 'qc', rule: 'bu' }, admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await listStickerTypes(env)).toHaveLength(1);
  });
});
