import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { getRoutes } from '@server/routes';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { restCall } from '@server-test/rest-call';
import { seedStickerType } from '@server-test/sticker-fixtures';
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
    const renamed = await saveStickerType(
      env,
      { id: qc.id, expectedUpdatedAt: qc.updatedAt, name: 'qc', rule: 'bu' },
      admin,
    );
    expect(renamed.name).toBe('qc');
    expect(await lastAudit()).toMatchObject({
      action: 'stickerType.update',
      before: { name: 'QC' },
      after: { name: 'qc' },
    });
    const error = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        { id: qc.id, expectedUpdatedAt: renamed.updatedAt, name: 'gudang', rule: 'bu' },
        admin,
      ),
    );
    expect(error.fields).toEqual({ name: 'Nama jenis sudah dipakai' });
  });

  test('id tidak dikenal pada ubah -> NOT_FOUND', async () => {
    const error = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        { id: 'tidak-ada', expectedUpdatedAt: 'x', name: 'X', rule: 'bu' },
        admin,
      ),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  test('rule tidak dikenal ditolak VALIDATION oleh validator', () => {
    const error = captureAppError(() => validateSaveStickerType({ name: 'X', rule: 'xyz' }));
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
    const changed = await saveStickerType(
      env,
      { id: type.id, expectedUpdatedAt: type.updatedAt, name: 'QC', rule: 'none' },
      admin,
    );
    expect(changed.rule).toBe('none');
    await insertSticker(type.id, 'Hijau');
    const error = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        { id: type.id, expectedUpdatedAt: changed.updatedAt, name: 'QC', rule: 'bu' },
        admin,
      ),
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
      { id: type.id, expectedUpdatedAt: changed.updatedAt, name: 'QC Baru', rule: 'none' },
      admin,
    );
    expect(renamed).toMatchObject({ name: 'QC Baru', rule: 'none', stickerCount: 1 });
  });

  test('hanya stiker hidup yang mengunci aturan: stiker terhapus tak menahan (keputusan pemilik 2026-11-21)', async () => {
    const type = await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
    await insertSticker(type.id, 'Hijau');
    await env.DB.prepare(
      "UPDATE stickers SET deleted_at = '2026-11-21T00:00:00.000Z', deleted_by = 'seed' WHERE name = 'Hijau'",
    ).run();
    const changed = await saveStickerType(
      env,
      { id: type.id, expectedUpdatedAt: type.updatedAt, name: 'QC', rule: 'none' },
      admin,
    );
    expect(changed.rule).toBe('none');
    // Stiker hidup baru mengunci lagi.
    await insertSticker(type.id, 'Biru');
    const error = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        { id: type.id, expectedUpdatedAt: changed.updatedAt, name: 'QC', rule: 'bu' },
        admin,
      ),
    );
    expect(error.code).toBe('VALIDATION');
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

  test('jenis sistem tidak dapat dinonaktifkan atau diaktifkan lewat setStatus (seperti ubah)', async () => {
    await seedStickerType(env, { id: 'mb', name: 'Manual Book', systemKind: 'manual_book' });
    const off = await captureAppErrorAsync(() =>
      setStickerTypeStatus(env, { id: 'mb', status: 'inactive' }, admin),
    );
    expect(off.code).toBe('VALIDATION');
    expect(off.message).toBe('Jenis stiker sistem tidak bisa diubah statusnya atau dihapus');
    const row = await env.DB.prepare('SELECT status FROM sticker_types WHERE id = ?')
      .bind('mb')
      .first<{ status: string }>();
    expect(row?.status).toBe('active');
    // Idempotensi tak melonggarkan: status yang sama pun ditolak untuk jenis sistem (satu aturan, tanpa cabang).
    const same = await captureAppErrorAsync(() =>
      setStickerTypeStatus(env, { id: 'mb', status: 'active' }, admin),
    );
    expect(same.code).toBe('VALIDATION');
  });

  test('versi: expectedUpdatedAt usang = galat usang tanpa menulis; hilang ditolak validator', async () => {
    const type = await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
    env.clock.set(Date.parse('2026-11-09T05:00:00.000Z'));
    const first = await saveStickerType(
      env,
      { id: type.id, expectedUpdatedAt: type.updatedAt, name: 'QC Satu', rule: 'bu' },
      admin,
    );
    env.clock.set(Date.parse('2026-11-09T06:00:00.000Z'));
    const stale = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        { id: type.id, expectedUpdatedAt: type.updatedAt, name: 'QC Basi', rule: 'bu' },
        admin,
      ),
    );
    expect(stale.code).toBe('CONFLICT');
    expect(stale.stale).toBe(true);
    const row = await env.DB.prepare('SELECT name, updated_at FROM sticker_types WHERE id = ?')
      .bind(type.id)
      .first<{ name: string; updated_at: string }>();
    expect(row).toEqual({ name: 'QC Satu', updated_at: first.updatedAt });
    const missing = captureAppError(() =>
      validateSaveStickerType({ id: type.id, name: 'X', rule: 'bu' }),
    );
    expect(missing.code).toBe('VALIDATION');
    expect(missing.fields).toHaveProperty('expectedUpdatedAt');
    expect(validateSaveStickerType({ name: 'Baru', rule: 'bu' })).not.toHaveProperty(
      'expectedUpdatedAt',
    );
  });

  test('dua simpan serentak dari versi yang sama: tepat satu berhasil', async () => {
    const type = await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
    env.clock.advance(1000);
    const results = await Promise.allSettled([
      saveStickerType(
        env,
        { id: type.id, expectedUpdatedAt: type.updatedAt, name: 'Satu', rule: 'bu' },
        admin,
      ),
      saveStickerType(
        env,
        { id: type.id, expectedUpdatedAt: type.updatedAt, name: 'Dua', rule: 'bu' },
        admin,
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CONFLICT', stale: true });
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

  test('pengguna tidak dapat membuat jenis group lewat stickerTypes.save (VALIDATION)', async () => {
    // Validator hanya memeriksa bentuk (aturan `group` dikenal agar form jenis sistem dapat mengirimnya);
    // penolakan untuk jenis biasa ada di service (`assertUserRule`), dan itu yang dijamin lewat REST.
    expect(validateSaveStickerType({ name: 'Kelompok', rule: 'group' })).toMatchObject({
      rule: 'group',
    });
    const result = await restCall(env, 'admin@gmail.com', 'stickerTypes.save', {
      name: 'Kelompok',
      rule: 'group',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await listStickerTypes(env)).toEqual([]);
  });

  test('jenis sistem muncul di daftar dengan systemKind, aturan group, dan minimum bawaan; jenis biasa kosong', async () => {
    await seedStickerType(env, {
      id: 'mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
      defaultMinQty: 30,
    });
    const biasa = await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
    expect(biasa).toMatchObject({ systemKind: '', defaultMinQty: 0 });
    const list = await listStickerTypes(env);
    expect(list.find((type) => type.id === 'mb')).toMatchObject({
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
      defaultMinQty: 30,
    });
    const viaRest = (await restCall(env, 'admin@gmail.com', 'stickerTypes.list', null)) as {
      ok: boolean;
      data: Array<{ id: string; systemKind: string }>;
    };
    expect(viaRest.data.find((type) => type.id === 'mb')?.systemKind).toBe('manual_book');
  });

  test('jenis sistem tidak dapat diubah lewat stickerTypes.save (nama maupun aturan)', async () => {
    await seedStickerType(env, {
      id: 'mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    const [mb] = await listStickerTypes(env);
    const error = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        { id: 'mb', expectedUpdatedAt: mb?.updatedAt ?? '', name: 'Lain', rule: 'bu' },
        admin,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect((await listStickerTypes(env))[0]).toMatchObject({ name: 'Manual Book', rule: 'group' });
  });

  test('izin rute: list=view atau item:edit, save=edit, setStatus=manage (modul sticker, global)', () => {
    const routes = getRoutes();
    // 3b-2: baca juga untuk pengubah item (editor instruksi stiker); hanya baca.
    expect(routes['stickerTypes.list'].permission).toEqual({
      anyOf: [
        { module: 'sticker', level: 'view' },
        { module: 'item', level: 'edit' },
      ],
    });
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
