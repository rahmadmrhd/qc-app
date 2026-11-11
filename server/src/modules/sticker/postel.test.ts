import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { uploadFile } from '@server/modules/files/service';
import { validateUploadFile } from '@server/modules/files/validate';
import { bytesOfBase64 } from '@server-test/bytes';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedManualBookVersion, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  ensurePostelSticker,
  ensurePostelType,
  POSTEL_STICKER_NAME,
  POSTEL_TYPE_NAME,
} from './postel';
import { listStickers, listStickerTypes, saveSticker, setStickerStatus } from './service';
import { validateSaveSticker, validateSetStickerStatus } from './validate';

// Jenis sistem dan stiker Postel (spek 4b §3/§4): dibuat idempoten, nama terkunci, gambar boleh diganti; aturan kunci
// Manual Book tak berubah.

setDefaultTimeout(60_000);

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

  test('jenis bernama Postel yang sudah berstiker ditolak: ganti nama dulu', async () => {
    await seedStickerType(env, { id: 't-old', name: 'Postel', rule: 'none' });
    await seedSticker(env, { id: 's-old', typeId: 't-old', name: 'Lama' });
    const error = await captureAppErrorAsync(() => ensurePostelType(env, admin));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('ganti namanya');
    expect(await count(POSTEL_TYPES_SQL)).toBe(0);
  });
});

describe('ensurePostelSticker', () => {
  test('tiga pemanggilan serentak menghasilkan satu jenis dan satu stiker bernama Postel', async () => {
    await seedStickerType(env, { id: 't-old', name: 'Postel', rule: 'none', defaultMinQty: 7 });
    const results = await Promise.all([
      ensurePostelSticker(env, admin),
      ensurePostelSticker(env, admin),
      ensurePostelSticker(env, admin),
    ]);
    expect(new Set(results.map((row) => row.stickerId)).size).toBe(1);
    expect(new Set(results.map((row) => row.typeId)).size).toBe(1);
    expect(await count(POSTEL_TYPES_SQL)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM stickers WHERE name = 'Postel'")).toBe(1);
    const sticker = (await listStickers(env)).find((row) => row.id === results[0]?.stickerId);
    expect(sticker?.name).toBe(POSTEL_STICKER_NAME);
    expect(sticker?.minQty).toBe(7);
    expect(sticker?.status).toBe('active');
  });

  test('serentak dari nol (jenis juga belum ada): tetap satu jenis dan satu stiker', async () => {
    const results = await Promise.all([
      ensurePostelSticker(env, admin),
      ensurePostelSticker(env, admin),
      ensurePostelSticker(env, admin),
    ]);
    expect(new Set(results.map((row) => row.stickerId)).size).toBe(1);
    expect(await count(POSTEL_TYPES_SQL)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM stickers')).toBe(1);
    const types = await listStickerTypes(env);
    expect(types.find((type) => type.systemKind === 'postel')?.stickerCount).toBe(1);
  });
});

describe('aturan stiker jenis Postel', () => {
  test('membuat stiker baru pada jenis postel ditolak VALIDATION', async () => {
    const { typeId } = await ensurePostelSticker(env, admin);
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
  });

  test('nama terkunci; gambar, minimum, dan alias dapat diubah', async () => {
    const { stickerId } = await ensurePostelSticker(env, admin);
    const renamed = await captureAppErrorAsync(() => editPostel(stickerId, { name: 'Lain' }));
    expect(renamed.code).toBe('VALIDATION');
    expect(renamed.fields).toHaveProperty('name');

    const file = await upload();
    const saved = await editPostel(stickerId, { fileId: file.id, minQty: 5, alias: 'Sertifikat' });
    expect(saved.fileId).toBe(file.id);
    expect(saved.minQty).toBe(5);
    expect(saved.alias).toBe('Sertifikat');
    expect(saved.name).toBe(POSTEL_STICKER_NAME);
    expect(saved.latestManualBookVersion).toBe(false);
  });

  test('nonaktifkan lalu aktifkan kembali berhasil', async () => {
    const { stickerId } = await ensurePostelSticker(env, admin);
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
