import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { uploadFile } from '@server/modules/files/service';
import { validateUploadFile } from '@server/modules/files/validate';
import { getRoutes } from '@server/routes';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { bytesOfBase64 } from '@server-test/bytes';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { seedManualBookVersion, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { StickerDto, StickerTypeDto } from '@shared/contract';
import type { StickerRule } from '@shared/stickers';
import {
  listStickers,
  saveSticker,
  saveStickerType,
  setStickerStatus,
  setStickerTypeStatus,
} from './service';
import { validateSaveSticker, validateSetStickerStatus } from './validate';

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

let env: TestEnv;
let admin: UserContext;
let qc: StickerTypeDto;
let none: StickerTypeDto;

const input = (overrides: Record<string, unknown> = {}) =>
  validateSaveSticker({
    typeId: qc.id,
    name: 'QC Spectrum/Teakwave',
    alias: '',
    fileId: null,
    minQty: 0,
    businessUnitIds: ['bu-a'],
    ...overrides,
  });

beforeEach(async () => {
  env = await createTestEnv({ FILE_CACHE: null });
  env.clock.set(Date.parse('2026-11-09T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
  await seedBusinessUnit(env, { id: 'bu-a', code: 'AA' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'BB' });
  await seedBusinessUnit(env, { id: 'bu-x', code: 'XX', status: 'inactive' });
  qc = await saveStickerType(env, { name: 'QC', rule: 'bu' }, admin);
  none = await saveStickerType(env, { name: 'Umum', rule: 'none' }, admin);
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

async function setStock(stickerId: string, locationId: string, qty: number) {
  await env.DB.prepare(
    'INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, ?, ?, ?)',
  )
    .bind(stickerId, locationId, qty, '2026-11-09T00:00:00.000Z')
    .run();
}

describe('katalog stiker', () => {
  test('membuat stiker dengan dua BU: id BU urut menurut kode BU; audit memuat minQty', async () => {
    const saved = await saveSticker(
      env,
      input({ businessUnitIds: ['bu-b', 'bu-a'], minQty: 25, alias: 'Stiker Hijau' }),
      admin,
    );
    expect(saved).toMatchObject({
      typeId: qc.id,
      typeName: 'QC',
      name: 'QC Spectrum/Teakwave',
      alias: 'Stiker Hijau',
      fileId: null,
      minQty: 25,
      status: 'active',
      businessUnitIds: ['bu-a', 'bu-b'],
      // stok 0 <= minimum 25: menipis (isLowStock)
      low: true,
      updatedAt: '2026-11-09T00:00:00.000Z',
    });
    expect(await listStickers(env)).toEqual([saved]);
    expect(await lastAudit()).toMatchObject({
      action: 'sticker.create',
      target: 'QC Spectrum/Teakwave',
      before: null,
      after: { name: 'QC Spectrum/Teakwave', minQty: 25, status: 'active' },
    });
  });

  test('jenis rule none: BU ditolak, tanpa BU berhasil; jenis rule bu: wajib minimal satu BU', async () => {
    const withBu = await captureAppErrorAsync(() =>
      saveSticker(env, input({ typeId: none.id, businessUnitIds: ['bu-a'] }), admin),
    );
    expect(withBu.code).toBe('VALIDATION');
    expect(withBu.fields).toHaveProperty('businessUnitIds');
    const ok = await saveSticker(env, input({ typeId: none.id, businessUnitIds: [] }), admin);
    expect(ok.businessUnitIds).toEqual([]);
    const missing = await captureAppErrorAsync(() =>
      saveSticker(env, input({ name: 'Lain', businessUnitIds: [] }), admin),
    );
    expect(missing.code).toBe('VALIDATION');
    expect(missing.fields).toHaveProperty('businessUnitIds');
  });

  test('nama kembar pada jenis sama (huruf/spasi ekor) konflik; pada jenis lain berhasil', async () => {
    await saveSticker(env, input(), admin);
    const dup = await captureAppErrorAsync(() =>
      saveSticker(env, input({ name: 'qc spectrum/teakwave ' }), admin),
    );
    expect(dup.code).toBe('CONFLICT');
    expect(dup.fields).toEqual({ name: 'Nama stiker sudah dipakai pada jenis ini' });
    const other = await saveSticker(
      env,
      input({ typeId: none.id, name: 'qc spectrum/teakwave ', businessUnitIds: [] }),
      admin,
    );
    expect(other.name).toBe('qc spectrum/teakwave');
    expect(await listStickers(env)).toHaveLength(2);
  });

  test('jenis stiker tidak dapat diubah setelah dibuat (VALIDATION); ubah nama/alias/minQty/BU', async () => {
    const saved = await saveSticker(env, input(), admin);
    const move = await captureAppErrorAsync(() =>
      saveSticker(
        env,
        input({
          id: saved.id,
          expectedUpdatedAt: saved.updatedAt,
          typeId: none.id,
          businessUnitIds: [],
        }),
        admin,
      ),
    );
    expect(move.code).toBe('VALIDATION');
    expect(move.fields).toHaveProperty('typeId');
    env.clock.set(Date.parse('2026-11-09T05:00:00.000Z'));
    const updated = await saveSticker(
      env,
      input({
        id: saved.id,
        expectedUpdatedAt: saved.updatedAt,
        name: 'Baru',
        alias: 'Hijau',
        minQty: 7,
        businessUnitIds: ['bu-b'],
      }),
      admin,
    );
    expect(updated).toMatchObject({
      id: saved.id,
      name: 'Baru',
      alias: 'Hijau',
      minQty: 7,
      businessUnitIds: ['bu-b'],
      updatedAt: '2026-11-09T05:00:00.000Z',
    });
    expect((await listStickers(env))[0]).toEqual(updated);
    expect(await lastAudit()).toMatchObject({
      action: 'sticker.update',
      before: { name: 'QC Spectrum/Teakwave', minQty: 0 },
      after: { name: 'Baru', minQty: 7 },
    });
    const missing = await captureAppErrorAsync(() =>
      saveSticker(env, input({ id: 'tidak-ada', expectedUpdatedAt: 'x' }), admin),
    );
    expect(missing.code).toBe('NOT_FOUND');
  });

  test('tanpa perubahan: tidak menulis dan tidak mengaudit', async () => {
    const saved = await saveSticker(env, input(), admin);
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{
      n: number;
    }>();
    env.clock.set(Date.parse('2026-11-09T05:00:00.000Z'));
    const again = await saveSticker(
      env,
      input({ id: saved.id, expectedUpdatedAt: saved.updatedAt }),
      admin,
    );
    expect(again).toEqual(saved);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{
      n: number;
    }>();
    expect(Number(after?.n)).toBe(Number(before?.n));
  });

  test('jenis nonaktif menolak stiker baru, tetapi stiker yang ada tetap dapat diubah', async () => {
    const saved = await saveSticker(env, input(), admin);
    await setStickerTypeStatus(env, { id: qc.id, status: 'inactive' }, admin);
    const rejected = await captureAppErrorAsync(() =>
      saveSticker(env, input({ name: 'Baru' }), admin),
    );
    expect(rejected.code).toBe('VALIDATION');
    expect(rejected.fields).toHaveProperty('typeId');
    const renamed = await saveSticker(
      env,
      input({ id: saved.id, expectedUpdatedAt: saved.updatedAt, name: 'Ganti' }),
      admin,
    );
    expect(renamed.name).toBe('Ganti');
    const unknownType = await captureAppErrorAsync(() =>
      saveSticker(env, input({ typeId: 'tidak-ada' }), admin),
    );
    expect(unknownType.code).toBe('VALIDATION');
  });

  test('BU yang ditambah harus aktif; BU nonaktif yang sudah melekat boleh dipertahankan', async () => {
    const bad = await captureAppErrorAsync(() =>
      saveSticker(env, input({ businessUnitIds: ['bu-x'] }), admin),
    );
    expect(bad.code).toBe('VALIDATION');
    expect(bad.fields).toEqual({ businessUnitIds: 'BU tidak dikenal atau tidak aktif' });
    const unknown = await captureAppErrorAsync(() =>
      saveSticker(env, input({ businessUnitIds: ['hantu'] }), admin),
    );
    expect(unknown.code).toBe('VALIDATION');
    const saved = await saveSticker(env, input(), admin);
    // sisipkan BU nonaktif langsung (seolah BU dinonaktifkan setelah menempel)
    await env.DB.prepare('INSERT INTO sticker_business_units (sticker_id, bu_id) VALUES (?, ?)')
      .bind(saved.id, 'bu-x')
      .run();
    const kept = await saveSticker(
      env,
      input({
        id: saved.id,
        expectedUpdatedAt: saved.updatedAt,
        businessUnitIds: ['bu-a', 'bu-x'],
        minQty: 3,
      }),
      admin,
    );
    expect(kept.businessUnitIds).toEqual(['bu-a', 'bu-x']);
  });

  test('status: nonaktifkan lalu aktifkan; audit sticker.status; idempoten; NOT_FOUND', async () => {
    const saved = await saveSticker(env, input({ minQty: 4 }), admin);
    env.clock.set(Date.parse('2026-11-09T01:00:00.000Z'));
    const off = await setStickerStatus(env, { id: saved.id, status: 'inactive' }, admin);
    expect(off).toMatchObject({ status: 'inactive', updatedAt: '2026-11-09T01:00:00.000Z' });
    expect(await lastAudit()).toMatchObject({
      action: 'sticker.status',
      target: 'QC Spectrum/Teakwave',
      before: { status: 'active', minQty: 4 },
      after: { status: 'inactive', minQty: 4 },
    });
    expect((await setStickerStatus(env, { id: saved.id, status: 'active' }, admin)).status).toBe(
      'active',
    );
    const count = async () =>
      Number(
        (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{ n: number }>())?.n,
      );
    const before = await count();
    await setStickerStatus(env, { id: saved.id, status: 'active' }, admin);
    expect(await count()).toBe(before);
    const missing = await captureAppErrorAsync(() =>
      setStickerStatus(env, { id: 'tidak-ada', status: 'inactive' }, admin),
    );
    expect(missing.code).toBe('NOT_FOUND');
  });

  test('low: total semua lokasi <= minimum (minimum > 0, stiker aktif); nonaktif atau minimum 0 tidak', async () => {
    const a = await saveSticker(env, input({ name: 'A', minQty: 10 }), admin);
    const b = await saveSticker(env, input({ name: 'B', minQty: 10 }), admin);
    const c = await saveSticker(env, input({ name: 'C', minQty: 0 }), admin);
    const d = await saveSticker(env, input({ name: 'D', minQty: 10 }), admin);
    await setStock(a.id, 'l1', 6);
    await setStock(a.id, 'l2', 4); // total 10 <= 10 -> low
    await setStock(b.id, 'l1', 6);
    await setStock(b.id, 'l2', 5); // total 11 -> tidak low
    // c: minimum 0 dan stok 0 -> tidak low; d: tanpa stok sama sekali, min 10 -> low (total 0)
    const byName = async () =>
      Object.fromEntries((await listStickers(env)).map((sticker) => [sticker.name, sticker.low]));
    expect(await byName()).toEqual({ A: true, B: false, C: false, D: true });
    const off = await setStickerStatus(env, { id: d.id, status: 'inactive' }, admin);
    expect(off.low).toBe(false);
    expect((await byName()).D).toBe(false);
    expect(c.low).toBe(false);
    const fresh = await saveSticker(
      env,
      input({ id: a.id, expectedUpdatedAt: a.updatedAt, minQty: 3 }),
      admin,
    );
    expect(fresh.low).toBe(false);
  });

  test('versi: expectedUpdatedAt usang = galat usang tanpa menulis apa pun; hilang ditolak validator', async () => {
    const saved = await saveSticker(env, input({ minQty: 500 }), admin);
    env.clock.set(Date.parse('2026-11-09T05:00:00.000Z'));
    const first = await saveSticker(
      env,
      input({ id: saved.id, expectedUpdatedAt: saved.updatedAt, minQty: 2000 }),
      admin,
    );
    expect(first.minQty).toBe(2000);
    const auditBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{
      n: number;
    }>();
    env.clock.set(Date.parse('2026-11-09T06:00:00.000Z'));
    // form basi (versi pertama) tidak boleh menimpa perubahan yang sudah masuk
    const stale = await captureAppErrorAsync(() =>
      saveSticker(
        env,
        input({ id: saved.id, expectedUpdatedAt: saved.updatedAt, alias: 'Basi', minQty: 500 }),
        admin,
      ),
    );
    expect(stale.code).toBe('CONFLICT');
    expect(stale.stale).toBe(true);
    const row = await env.DB.prepare('SELECT alias, min_qty, updated_at FROM stickers WHERE id = ?')
      .bind(saved.id)
      .first<{ alias: string; min_qty: number; updated_at: string }>();
    expect(row).toMatchObject({ alias: '', updated_at: first.updatedAt });
    expect(Number(row?.min_qty)).toBe(2000);
    const auditAfter = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{
      n: number;
    }>();
    expect(Number(auditAfter?.n)).toBe(Number(auditBefore?.n));
    const missing = captureAppError(() =>
      validateSaveSticker({
        id: saved.id,
        typeId: qc.id,
        name: 'X',
        alias: '',
        fileId: null,
        minQty: 0,
        businessUnitIds: ['bu-a'],
      }),
    );
    expect(missing.code).toBe('VALIDATION');
    expect(missing.fields).toHaveProperty('expectedUpdatedAt');
    // membuat baru tidak butuh versi
    expect(input({ name: 'Baru' })).not.toHaveProperty('expectedUpdatedAt');
  });

  test('dua simpan serentak dari versi yang sama: tepat satu berhasil, yang lain galat usang', async () => {
    for (let round = 0; round < 3; round++) {
      const saved = await saveSticker(env, input({ name: `Serentak ${round}` }), admin);
      env.clock.advance(1000);
      const results = await Promise.allSettled([
        saveSticker(
          env,
          input({ id: saved.id, expectedUpdatedAt: saved.updatedAt, name: saved.name, minQty: 11 }),
          admin,
        ),
        saveSticker(
          env,
          input({ id: saved.id, expectedUpdatedAt: saved.updatedAt, name: saved.name, minQty: 22 }),
          admin,
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'CONFLICT', stale: true });
      const winner = results.find(
        (r) => r.status === 'fulfilled',
      ) as PromiseFulfilledResult<StickerDto>;
      const row = await env.DB.prepare('SELECT min_qty FROM stickers WHERE id = ?')
        .bind(saved.id)
        .first<{ min_qty: number }>();
      expect(Number(row?.min_qty)).toBe(winner.value.minQty);
    }
  });

  test('REST: PUT /stickers/{id} dengan If-Match basi = 412; tanpa If-Match = 422; ETag = updatedAt', async () => {
    const rest = restClient(env);
    const body = {
      typeId: qc.id,
      name: 'Via REST',
      alias: '',
      fileId: null,
      minQty: 1,
      businessUnitIds: ['bu-a'],
    };
    const created = (await jsonOf(await rest.post('/stickers', { body }))) as unknown as StickerDto;
    env.clock.advance(1000);
    const noHeader = await rest.put(`/stickers/${created.id}`, { body: { ...body, minQty: 2 } });
    expect(noHeader.status).toBe(422);
    const ok = await rest.put(`/stickers/${created.id}`, {
      headers: { 'if-match': `"${created.updatedAt}"` },
      body: { ...body, minQty: 2 },
    });
    expect(ok.status).toBe(200);
    const updated = (await jsonOf(ok)) as unknown as StickerDto;
    expect(ok.headers.get('etag')).toBe(`"${updated.updatedAt}"`);
    const stale = await rest.put(`/stickers/${created.id}`, {
      headers: { 'if-match': `"${created.updatedAt}"` },
      body: { ...body, minQty: 3 },
    });
    expect(stale.status).toBe(412);
    const row = await env.DB.prepare('SELECT min_qty FROM stickers WHERE id = ?')
      .bind(created.id)
      .first<{ min_qty: number }>();
    expect(Number(row?.min_qty)).toBe(2);
  });

  test('validator: minQty bulat 0..qtyMax, fileId teks atau null, nama dan alias dibatasi', () => {
    const bad = (overrides: Record<string, unknown>) =>
      captureAppError(() =>
        validateSaveSticker({
          typeId: 't',
          name: 'N',
          alias: '',
          fileId: null,
          minQty: 0,
          businessUnitIds: [],
          ...overrides,
        }),
      );
    expect(bad({ minQty: -1 }).fields).toHaveProperty('minQty');
    expect(bad({ minQty: 1.5 }).fields).toHaveProperty('minQty');
    expect(bad({ minQty: 1_000_001 }).fields).toHaveProperty('minQty');
    expect(bad({ minQty: '5' }).fields).toHaveProperty('minQty');
    expect(bad({ fileId: 5 }).fields).toHaveProperty('fileId');
    expect(bad({ name: ' ' }).fields).toHaveProperty('name');
    expect(bad({ name: 'x'.repeat(121) }).fields).toHaveProperty('name');
    expect(bad({ alias: 'x'.repeat(121) }).fields).toHaveProperty('alias');
    expect(bad({ businessUnitIds: 'x' }).fields).toHaveProperty('businessUnitIds');
    expect(
      bad({ businessUnitIds: Array.from({ length: 51 }, (_, i) => `b${i}`) }).fields,
    ).toHaveProperty('businessUnitIds');
    expect(bad({ typeId: '' }).fields).toHaveProperty('typeId');
    expect(
      validateSaveSticker({
        typeId: 't',
        name: ' N ',
        alias: ' a ',
        fileId: '',
        minQty: 1_000_000,
        businessUnitIds: ['b', 'b', ' c '],
      }),
    ).toEqual({
      typeId: 't',
      name: 'N',
      alias: 'a',
      fileId: null,
      minQty: 1_000_000,
      businessUnitIds: ['b', 'c'],
    });
    expect(validateSetStickerStatus({ id: 'x', status: 'inactive' })).toEqual({
      id: 'x',
      status: 'inactive',
    });
    expect(captureAppError(() => validateSetStickerStatus({ id: 'x', status: 'y' })).code).toBe(
      'VALIDATION',
    );
  });

  test('izin rute: list=view, save=edit, setStatus=manage (modul sticker); options menerima sticker view', () => {
    const routes = getRoutes();
    // 3b-2: baca katalog juga untuk pengubah item (editor instruksi stiker), hanya baca.
    expect(routes['stickers.list'].permission).toEqual({
      anyOf: [
        { module: 'sticker', level: 'view' },
        { module: 'item', level: 'edit' },
      ],
    });
    expect(routes['stickerTypes.list'].permission).toEqual({
      anyOf: [
        { module: 'sticker', level: 'view' },
        { module: 'item', level: 'edit' },
      ],
    });
    expect(routes['stickers.save'].permission).toEqual({ module: 'sticker', level: 'edit' });
    expect(routes['stickers.setStatus'].permission).toEqual({ module: 'sticker', level: 'manage' });
  });
});

describe('stiker jenis sistem dan status deprecated', () => {
  beforeEach(async () => {
    await seedStickerType(env, {
      id: 'mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    await seedSticker(env, { id: 'mb-1', typeId: 'mb', name: 'PBE M5 v1', minQty: 10 });
    await seedManualBookVersion(env, { stickerId: 'mb-1', designId: 'q1', version: 1 });
  });

  const current = async () => (await listStickers(env)).find((sticker) => sticker.id === 'mb-1');
  const edit = async (overrides: Record<string, unknown>) => {
    const sticker = await current();
    return saveSticker(
      env,
      validateSaveSticker({
        id: 'mb-1',
        expectedUpdatedAt: sticker?.updatedAt,
        typeId: 'mb',
        name: 'PBE M5 v1',
        alias: '',
        fileId: null,
        minQty: 10,
        businessUnitIds: [],
        ...overrides,
      }),
      admin,
    );
  };

  test('membuat stiker baru pada jenis sistem ditolak VALIDATION', async () => {
    const error = await captureAppErrorAsync(() =>
      saveSticker(env, input({ typeId: 'mb', name: 'Baru', businessUnitIds: [] }), admin),
    );
    expect(error.code).toBe('VALIDATION');
  });

  test('mengubah nama atau gambar stiker jenis sistem ditolak; jenis tetap tak dapat diganti', async () => {
    const renamed = await captureAppErrorAsync(() => edit({ name: 'Lain' }));
    expect(renamed.code).toBe('VALIDATION');
    expect(renamed.fields).toHaveProperty('name');
    const withFile = await captureAppErrorAsync(() => edit({ fileId: 'f-1' }));
    expect(withFile.code).toBe('VALIDATION');
    expect(withFile.fields).toHaveProperty('fileId');
    const retyped = await captureAppErrorAsync(() => edit({ typeId: qc.id }));
    expect(retyped.code).toBe('VALIDATION');
    expect((await current())?.name).toBe('PBE M5 v1');
  });

  test('BU pada jenis aturan group ditolak', async () => {
    const error = await captureAppErrorAsync(() => edit({ businessUnitIds: ['bu-a'] }));
    expect(error.code).toBe('VALIDATION');
    expect(error.fields).toHaveProperty('businessUnitIds');
  });

  test('minQty dan alias stiker jenis sistem dapat diubah', async () => {
    const saved = await edit({ minQty: 40, alias: 'Manual PBE' });
    expect(saved).toMatchObject({ minQty: 40, alias: 'Manual PBE', name: 'PBE M5 v1' });
    expect(await current()).toMatchObject({ minQty: 40, alias: 'Manual PBE' });
  });

  test('stickers.list memuat status deprecated; low false untuk deprecated', async () => {
    await seedSticker(env, {
      id: 'mb-0',
      typeId: 'mb',
      name: 'PBE M5 v0',
      status: 'deprecated',
      minQty: 50,
    });
    const list = await listStickers(env);
    expect(list.find((sticker) => sticker.id === 'mb-0')).toMatchObject({
      status: 'deprecated',
      low: false,
    });
    expect(list.find((sticker) => sticker.id === 'mb-1')).toMatchObject({
      status: 'active',
      low: true,
    });
  });

  test('setStatus: deprecated -> active ditolak, deprecated -> inactive berhasil', async () => {
    await seedSticker(env, { id: 'mb-0', typeId: 'mb', name: 'PBE M5 v0', status: 'deprecated' });
    const refused = await captureAppErrorAsync(() =>
      setStickerStatus(env, { id: 'mb-0', status: 'active' }, admin),
    );
    expect(refused.code).toBe('VALIDATION');
    expect((await listStickers(env)).find((s) => s.id === 'mb-0')?.status).toBe('deprecated');
    const off = await setStickerStatus(env, { id: 'mb-0', status: 'inactive' }, admin);
    expect(off.status).toBe('inactive');
  });

  test('setStatus: stiker jenis sistem yang bukan versi terbaru tidak boleh diaktifkan; versi terbaru boleh', async () => {
    await seedSticker(env, { id: 'mb-2', typeId: 'mb', name: 'PBE M5 v2', status: 'inactive' });
    await seedManualBookVersion(env, { stickerId: 'mb-2', designId: 'q1', version: 2 });
    await setStickerStatus(env, { id: 'mb-1', status: 'inactive' }, admin);
    const refused = await captureAppErrorAsync(() =>
      setStickerStatus(env, { id: 'mb-1', status: 'active' }, admin),
    );
    expect(refused.code).toBe('VALIDATION');
    expect((await setStickerStatus(env, { id: 'mb-2', status: 'active' }, admin)).status).toBe(
      'active',
    );
  });
});

describe('gambar contoh stiker', () => {
  async function upload(actor: UserContext = admin) {
    return uploadFile(
      env,
      validateUploadFile({
        mime: 'image/png',
        bytes: bytesOfBase64(PNG),
        width: 1,
        height: 1,
      }),
      actor,
    );
  }

  beforeEach(async () => {
    await seedRole(env, {
      id: 'r-stk-view',
      name: 'Lihat Stiker',
      permissions: { sticker: 'view' },
    });
    await seedRole(env, {
      id: 'r-stk-edit',
      name: 'Edit Stiker',
      permissions: { sticker: 'edit' },
    });
    await seedRole(env, { id: 'r-item-view', name: 'Lihat Item', permissions: { item: 'view' } });
    await seedUser(env, { id: 'u-sv', email: 'sv@gmail.com', roleIds: ['r-stk-view'] });
    await seedUser(env, { id: 'u-se', email: 'se@gmail.com', roleIds: ['r-stk-edit'] });
    await seedUser(env, { id: 'u-iv', email: 'iv@gmail.com', roleIds: ['r-item-view'] });
    await seedUser(env, { id: 'u-nol', email: 'nol@gmail.com' });
  });

  test('fileId dipasang: pemilik berkas jadi sticker; berkas orang lain/sudah dipakai ditolak', async () => {
    const file = await upload();
    const saved = await saveSticker(env, input({ fileId: file.id }), admin);
    expect(saved.fileId).toBe(file.id);
    const owner = await env.DB.prepare('SELECT owner_type, owner_id FROM files WHERE id = ?')
      .bind(file.id)
      .first<{ owner_type: string; owner_id: string }>();
    expect(owner).toEqual({ owner_type: 'sticker', owner_id: saved.id });
    const reuse = await captureAppErrorAsync(() =>
      saveSticker(env, input({ name: 'Lain', fileId: file.id }), admin),
    );
    expect(reuse.code).toBe('CONFLICT');
    expect(reuse.fields).toHaveProperty('fileId');
    const unknown = await captureAppErrorAsync(() =>
      saveSticker(env, input({ name: 'Lain 2', fileId: 'tidak-ada' }), admin),
    );
    expect(unknown.code).toBe('VALIDATION');
    expect(unknown.fields).toHaveProperty('fileId');
    // tidak ada stiker tersimpan setengah jalan
    expect(await listStickers(env)).toHaveLength(1);
    // berkas item tidak dapat dipasang ke stiker (dijawab seperti berkas tak dikenal)
    const itemFile = await upload();
    await env.DB.prepare("UPDATE files SET owner_type = 'item', owner_id = 'i1' WHERE id = ?")
      .bind(itemFile.id)
      .run();
    const fromItem = await captureAppErrorAsync(() =>
      saveSticker(env, input({ name: 'Lain 3', fileId: itemFile.id }), admin),
    );
    expect(fromItem.code).toBe('VALIDATION');
    // mengganti dengan null melepas rujukan di stiker
    const cleared = await saveSticker(
      env,
      input({ id: saved.id, expectedUpdatedAt: saved.updatedAt, fileId: null }),
      admin,
    );
    expect(cleared.fileId).toBeNull();
  });

  test('pemegang sticker:view tanpa izin item membaca berkas pemilik sticker, bukan berkas item', async () => {
    const stickerFile = await upload();
    await saveSticker(env, input({ fileId: stickerFile.id }), admin);
    const itemFile = await upload();
    await env.DB.prepare("UPDATE files SET owner_type = 'item', owner_id = 'i1' WHERE id = ?")
      .bind(itemFile.id)
      .run();
    await env.DB.prepare('INSERT INTO item_business_units (item_id, bu_id) VALUES (?, ?)')
      .bind('i1', 'bu-a')
      .run();
    const read = await restCall(env, 'sv@gmail.com', 'files.get', { id: stickerFile.id });
    expect(read).toMatchObject({ ok: true, data: { id: stickerFile.id, mime: 'image/png' } });
    expect(await restCall(env, 'sv@gmail.com', 'files.get', { id: itemFile.id })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    // pemegang item:view (tanpa sticker) juga dapat membaca gambar contoh stiker
    expect(await restCall(env, 'iv@gmail.com', 'files.get', { id: stickerFile.id })).toMatchObject({
      ok: true,
    });
    // tanpa izin sama sekali: ditolak di rute
    expect(await restCall(env, 'nol@gmail.com', 'files.get', { id: stickerFile.id })).toMatchObject(
      { ok: false, error: { code: 'FORBIDDEN' } },
    );
  });

  test('sticker:edit dapat mengunggah gambar; sticker:view tidak', async () => {
    const payload = { mime: 'image/png', bytes: bytesOfBase64(PNG), width: 1, height: 1 };
    expect(await restCall(env, 'se@gmail.com', 'files.upload', payload)).toMatchObject({
      ok: true,
    });
    expect(await restCall(env, 'sv@gmail.com', 'files.upload', payload)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  test('businessUnits.options: pengguna sticker:edit tanpa izin lain memuat opsi BU', async () => {
    const result = await restCall(env, 'se@gmail.com', 'businessUnits.options', null);
    expect(result).toMatchObject({ ok: true });
    expect((result as { data: { id: string }[] }).data.map((bu) => bu.id).sort()).toEqual([
      'bu-a',
      'bu-b',
      'bu-x',
    ]);
    expect(await restCall(env, 'nol@gmail.com', 'businessUnits.options', null)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  test('rute REST stickers.*: izin per level', async () => {
    const body = {
      typeId: qc.id,
      name: 'Via REST',
      alias: '',
      fileId: null,
      minQty: 2,
      businessUnitIds: ['bu-a'],
    };
    expect(await restCall(env, 'sv@gmail.com', 'stickers.save', body)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    const created = await restCall(env, 'se@gmail.com', 'stickers.save', body);
    expect(created).toMatchObject({ ok: true, data: { name: 'Via REST', typeName: 'QC' } });
    const id = (created as { data: { id: string } }).data.id;
    expect(await restCall(env, 'sv@gmail.com', 'stickers.list', null)).toMatchObject({
      ok: true,
      data: [{ id }],
    });
    expect(
      await restCall(env, 'se@gmail.com', 'stickers.setStatus', { id, status: 'inactive' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await restCall(env, 'admin@gmail.com', 'stickers.setStatus', { id, status: 'inactive' }),
    ).toMatchObject({ ok: true, data: { status: 'inactive' } });
  });
});

describe('konkurensi jenis vs stiker', () => {
  test('menonaktifkan jenis serentak dengan membuat stiker: tidak ada stiker baru di jenis nonaktif', async () => {
    for (let round = 0; round < 4; round++) {
      const type = await saveStickerType(env, { name: `Jenis ${round}`, rule: 'bu' }, admin);
      const results = await Promise.allSettled([
        setStickerTypeStatus(env, { id: type.id, status: 'inactive' }, admin),
        saveSticker(env, input({ typeId: type.id, name: `S${round}` }), admin),
      ]);
      const [deactivate, create] = results;
      expect(deactivate?.status).toBe('fulfilled');
      if (create?.status === 'rejected') {
        expect((create.reason as { code?: string }).code).toBe('VALIDATION');
      }
      const row = await env.DB.prepare('SELECT status FROM sticker_types WHERE id = ?')
        .bind(type.id)
        .first<{ status: string }>();
      expect(row?.status).toBe('inactive');
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM stickers WHERE type_id = ?')
        .bind(type.id)
        .first<{ n: number }>();
      expect(Number(count?.n)).toBe(create?.status === 'fulfilled' ? 1 : 0);
    }
  });

  test('mengubah rule jenis serentak dengan membuat stiker: rule dan stiker tetap konsisten', async () => {
    for (let round = 0; round < 4; round++) {
      const type = await saveStickerType(env, { name: `Aturan ${round}`, rule: 'bu' }, admin);
      const rule: StickerRule = 'none';
      const results = await Promise.allSettled([
        saveStickerType(
          env,
          { id: type.id, expectedUpdatedAt: type.updatedAt, name: type.name, rule },
          admin,
        ),
        saveSticker(env, input({ typeId: type.id, name: `S${round}` }), admin),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect((result.reason as { code?: string }).code).toBe('VALIDATION');
        }
      }
      // invarian: stiker di jenis 'none' tidak pernah punya BU, stiker di jenis 'bu' selalu punya BU
      const rows = await env.DB.prepare(
        'SELECT t.rule AS rule, s.id AS id, (SELECT COUNT(*) FROM sticker_business_units b WHERE b.sticker_id = s.id) AS bus FROM stickers s JOIN sticker_types t ON t.id = s.type_id WHERE s.type_id = ?',
      )
        .bind(type.id)
        .all<{ rule: string; id: string; bus: number }>();
      for (const row of rows.results) {
        expect(row.rule === 'none' ? Number(row.bus) === 0 : Number(row.bus) > 0).toBe(true);
      }
      // tepat satu pihak menang (yang kalah ditolak VALIDATION)
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }
  });
});
