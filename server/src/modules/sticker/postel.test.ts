import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { uploadFile } from '@server/modules/files/service';
import { validateUploadFile } from '@server/modules/files/validate';
import { bytesOfBase64 } from '@server-test/bytes';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedPostel } from '@server-test/postel-fixtures';
import { seedManualBookVersion, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { ensurePostelType, POSTEL_TYPE_NAME } from './postel';
import {
  listStickers,
  listStickerTypes,
  saveSticker,
  saveStickerType,
  setStickerStatus,
  setStickerTypeStatus,
} from './service';
import { validateSaveSticker, validateSetStickerStatus } from './validate';

// Jenis sistem dan stiker Postel (spek 4b §3/§4, stiker per catatan sejak 2026-11-12): jenis dibuat idempoten, nama
// stiker terkunci, gambar boleh diganti; aturan kunci Manual Book tak berubah. Lahirnya stiker per catatan diuji di
// `postel/stickers.test.ts` dan `postel/rest.test.ts`.

setDefaultTimeout(60_000);

const POSTEL_MESSAGE =
  'Stiker Postel dibuat otomatis; hanya minimum stok, alias, gambar, dan status yang dapat diubah';
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

let env: TestEnv;
let admin: UserContext;

beforeEach(async () => {
  env = await createTestEnv({ FILE_CACHE: null });
  env.clock.set(Date.parse('2026-11-11T03:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

const count = async (sql: string): Promise<number> =>
  Number((await env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0);

const POSTEL_TYPES_SQL = "SELECT COUNT(*) AS n FROM sticker_types WHERE system_kind = 'postel'";

async function upload() {
  return uploadFile(
    env,
    validateUploadFile({ mime: 'image/png', bytes: bytesOfBase64(PNG), width: 1, height: 1 }),
    admin,
  );
}

const STICKER_NAME = 'Postel - Uji';

/** Stiker Postel yang lahir bersama sebuah catatan (di sini disemai langsung pada jenis Postel). */
async function postelSticker(): Promise<{ typeId: string; stickerId: string }> {
  const type = await ensurePostelType(env, admin);
  await seedSticker(env, { id: 's-postel', typeId: type.id, name: STICKER_NAME });
  // Stiker Postel selalu milik sebuah catatan; tanpa catatan pemiliknya stiker tak dapat diaktifkan kembali.
  await seedPostel(env, {
    id: 'p-owner',
    stickerId: 's-postel',
    numbers: [{ number: 'OWN-1', expiresOn: '2027-01-01' }],
  });
  return { typeId: type.id, stickerId: 's-postel' };
}

const editPostel = async (stickerId: string, overrides: Record<string, unknown>) => {
  const sticker = (await listStickers(env)).find((row) => row.id === stickerId);
  if (!sticker) throw new Error('stiker Postel hilang');
  return saveSticker(
    env,
    validateSaveSticker({
      id: sticker.id,
      expectedUpdatedAt: sticker.updatedAt,
      typeId: sticker.typeId,
      name: sticker.name,
      alias: sticker.alias,
      fileId: sticker.fileId,
      minQty: sticker.minQty,
      businessUnitIds: [],
      ...overrides,
    }),
    admin,
  );
};

describe('ensurePostelType', () => {
  test('membuat jenis sistem postel beraturan group, aktif', async () => {
    const type = await ensurePostelType(env, admin);
    expect(type.name).toBe(POSTEL_TYPE_NAME);
    expect(type.rule).toBe('group');
    expect(type.systemKind).toBe('postel');
    expect(type.status).toBe('active');
    const again = await ensurePostelType(env, admin);
    expect(again.id).toBe(type.id);
    expect(await count(POSTEL_TYPES_SQL)).toBe(1);
  });

  test('jenis biasa bernama Postel tanpa stiker diadopsi', async () => {
    await seedStickerType(env, { id: 't-old', name: 'postel', rule: 'none' });
    const type = await ensurePostelType(env, admin);
    expect(type.id).toBe('t-old');
    expect(type.rule).toBe('group');
    expect(type.systemKind).toBe('postel');
  });

  test('jenis nonaktif bernama Postel yang diadopsi menjadi aktif', async () => {
    await seedStickerType(env, { id: 't-off', name: 'Postel', rule: 'none', status: 'inactive' });
    const type = await ensurePostelType(env, admin);
    expect(type.id).toBe('t-off');
    expect(type.status).toBe('active');
    expect(type.systemKind).toBe('postel');
  });

  test('jenis bernama Postel yang sudah berstiker ditolak: ganti nama dulu', async () => {
    await seedStickerType(env, { id: 't-old', name: 'Postel', rule: 'none' });
    await seedSticker(env, { id: 's-old', typeId: 't-old', name: 'Lama' });
    const error = await captureAppErrorAsync(() => ensurePostelType(env, admin));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('ganti namanya');
    expect(await count(POSTEL_TYPES_SQL)).toBe(0);
  });
});

describe('ensurePostelType serentak', () => {
  test('tiga pemanggilan serentak (jenis lama bernama Postel) menghasilkan satu jenis', async () => {
    await seedStickerType(env, { id: 't-old', name: 'Postel', rule: 'none', defaultMinQty: 7 });
    const results = await Promise.all([
      ensurePostelType(env, admin),
      ensurePostelType(env, admin),
      ensurePostelType(env, admin),
    ]);
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(await count(POSTEL_TYPES_SQL)).toBe(1);
    expect(results[0]?.defaultMinQty).toBe(7);
  });

  test('serentak dari nol (jenis juga belum ada): tetap satu jenis, tanpa stiker', async () => {
    const results = await Promise.all([
      ensurePostelType(env, admin),
      ensurePostelType(env, admin),
      ensurePostelType(env, admin),
    ]);
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(await count(POSTEL_TYPES_SQL)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM stickers')).toBe(0);
  });
});

describe('aturan stiker jenis Postel', () => {
  test('membuat stiker baru pada jenis postel ditolak VALIDATION', async () => {
    const { typeId } = await postelSticker();
    const error = await captureAppErrorAsync(() =>
      saveSticker(
        env,
        validateSaveSticker({
          typeId,
          name: 'Postel 2',
          alias: '',
          fileId: null,
          minQty: 0,
          businessUnitIds: [],
        }),
        admin,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toBe(POSTEL_MESSAGE);
  });

  test('nama terkunci; gambar, minimum, dan alias dapat diubah', async () => {
    const { stickerId } = await postelSticker();
    const renamed = await captureAppErrorAsync(() => editPostel(stickerId, { name: 'Lain' }));
    expect(renamed.code).toBe('VALIDATION');
    expect(renamed.fields).toHaveProperty('name');
    expect(renamed.message).toBe(POSTEL_MESSAGE);

    const file = await upload();
    const saved = await editPostel(stickerId, { fileId: file.id, minQty: 5, alias: 'Sertifikat' });
    expect(saved.fileId).toBe(file.id);
    expect(saved.minQty).toBe(5);
    expect(saved.alias).toBe('Sertifikat');
    expect(saved.name).toBe(STICKER_NAME);
    expect(saved.latestManualBookVersion).toBe(false);
  });

  test('nonaktifkan lalu aktifkan kembali berhasil', async () => {
    const { stickerId } = await postelSticker();
    const off = await setStickerStatus(
      env,
      validateSetStickerStatus({
        id: stickerId,
        status: 'inactive',
      }),
      admin,
    );
    expect(off.status).toBe('inactive');
    const on = await setStickerStatus(
      env,
      validateSetStickerStatus({ id: stickerId, status: 'active' }),
      admin,
    );
    expect(on.status).toBe('active');
  });
});

describe('jenis Postel dikelola aplikasi', () => {
  test('stickerTypes.save dan setStatus terhadap jenis postel ditolak', async () => {
    const { typeId } = await postelSticker();
    const type = (await listStickerTypes(env)).find((row) => row.id === typeId);
    if (!type) throw new Error('jenis Postel hilang');
    const renamed = await captureAppErrorAsync(() =>
      saveStickerType(
        env,
        { id: type.id, expectedUpdatedAt: type.updatedAt, name: 'Lain', rule: 'group' },
        admin,
      ),
    );
    expect(renamed.code).toBe('VALIDATION');
    const off = await captureAppErrorAsync(() =>
      setStickerTypeStatus(env, { id: type.id, status: 'inactive' }, admin),
    );
    expect(off.code).toBe('VALIDATION');
    const after = (await listStickerTypes(env)).find((row) => row.id === typeId);
    expect(after?.name).toBe(POSTEL_TYPE_NAME);
    expect(after?.status).toBe('active');
  });
});

describe('stiker Manual Book tetap terkunci', () => {
  beforeEach(async () => {
    await seedStickerType(env, {
      id: 'mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    await seedSticker(env, { id: 'mb-1', typeId: 'mb', name: 'PBE v1', status: 'inactive' });
    await seedSticker(env, { id: 'mb-2', typeId: 'mb', name: 'PBE v2' });
    await seedManualBookVersion(env, { stickerId: 'mb-1', designId: 'q1', version: 1 });
    await seedManualBookVersion(env, { stickerId: 'mb-2', designId: 'q1', version: 2 });
  });

  test('ubah gambar ditolak', async () => {
    const sticker = (await listStickers(env)).find((row) => row.id === 'mb-2');
    const error = await captureAppErrorAsync(() =>
      saveSticker(
        env,
        validateSaveSticker({
          id: 'mb-2',
          expectedUpdatedAt: sticker?.updatedAt,
          typeId: 'mb',
          name: 'PBE v2',
          alias: '',
          fileId: 'f-1',
          minQty: 0,
          businessUnitIds: [],
        }),
        admin,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fields).toHaveProperty('fileId');
  });

  test('aktifkan versi yang bukan terbaru ditolak', async () => {
    const error = await captureAppErrorAsync(() =>
      setStickerStatus(env, validateSetStickerStatus({ id: 'mb-1', status: 'active' }), admin),
    );
    expect(error.code).toBe('VALIDATION');
  });
});
