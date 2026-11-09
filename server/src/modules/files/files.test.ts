import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Db, DbStatement } from '@server/core/db';
import type { FileCache } from '@server/core/file-cache';
import { createMemoryFileCache, fileCacheKey } from '@server/core/file-cache';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { bytesOfBase64 } from '@server-test/bytes';
import { captureAppError, captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { MAX_IMAGE_BYTES, MAX_UNATTACHED_UPLOADS } from '@shared/files';
import {
  attachFiles,
  DRIVE_FOLDER_NAME,
  deleteFiles,
  ensureDriveFolder,
  markFilesPendingDelete,
  planAttachFiles,
  purgePendingFiles,
  readFile,
  uploadFile,
} from './service';
import { validateGetFile, validateUploadFile } from './validate';

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

/** Pembaca dengan izin item dan BU `bu-a`; berkas tanpa pemilik atau bukan milik item tak dibatasi BU. */
const ALL_BU_VIEWER = {
  email: 'admin@gmail.com',
  itemBuIds: ['bu-a'],
  canReadStickerFiles: true,
} as const;
/** Pembaca tanpa izin item global: hanya logo bersama dan unggahan miliknya. */
const NO_ITEM = {
  email: 'lain@gmail.com',
  itemBuIds: null,
  canReadStickerFiles: false,
} as const;
const JPEG = '/9j/4AAQSkZJRg==';

let env: TestEnv;
let admin: UserContext;
const realError = console.error;
let logged: string[];

const upload = (overrides: Record<string, unknown> = {}) => ({
  mime: 'image/png',
  bytes: bytesOfBase64(PNG),
  width: 1,
  height: 1,
  ...overrides,
});

class MemoryFileCache implements FileCache {
  store = new Map<string, string>();
  gets = 0;
  async get(key: string) {
    this.gets++;
    const base64 = this.store.get(key);
    return base64 === undefined ? null : { mime: 'image/png', base64 };
  }
  async put(key: string, _mime: string, base64: string) {
    this.store.set(key, base64);
  }
}

async function files() {
  const rows = await env.DB.prepare(
    'SELECT id, drive_id, owner_type, owner_id, created_by, created_at, status FROM files',
  ).all<{
    id: string;
    drive_id: string;
    owner_type: string;
    owner_id: string;
    created_by: string;
    created_at: string;
    status: string;
  }>();
  const rank = (id: string) => {
    const i = uploadOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...rows.results].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

// MariaDB tidak punya rowid: urutan sisip dicatat di tes agar `files()` deterministik.
let uploadOrder: string[] = [];

async function up(input = upload(), actor = admin) {
  const saved = await uploadFile(env, validateUploadFile(input), actor);
  uploadOrder.push(saved.id);
  return saved;
}

beforeEach(async () => {
  logged = [];
  uploadOrder = [];
  console.error = (message?: unknown) => {
    logged.push(String(message));
  };
  env = await createTestEnv({ FILE_CACHE: null });
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

afterEach(() => {
  console.error = realError;
});

describe('unggah', () => {
  test('menyimpan ke Drive lewat jembatan dan mencatat metadata tanpa pemilik', async () => {
    const saved = await up();
    expect(saved).toMatchObject({ mime: 'image/png', width: 1, height: 1, size: 16 });
    const rows = await files();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: saved.id,
      owner_type: '',
      owner_id: '',
      created_by: 'admin@gmail.com',
      created_at: '2026-10-09T00:00:00.000Z',
      status: 'active',
    });
    expect(env.BRIDGE.state.files.size).toBe(1);
    const first = [...env.BRIDGE.state.files.values()][0];
    expect(first?.name).toBe(`${saved.id}.png`);
    expect(first?.base64).toBe(PNG);
  });

  test('urutan Drive dulu, lalu database: jembatan gagal = tidak ada baris files, galat UNAVAILABLE jelas', async () => {
    await ensureDriveFolder(env);
    env.BRIDGE.failNext('createFile', new Error('Drive 500'));
    const error = await captureAppErrorAsync(() => up());
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toContain('Google Drive');
    expect(await files()).toHaveLength(0);
    expect(env.BRIDGE.state.files.size).toBe(0);
    // ulang aman
    await up();
    expect(await files()).toHaveLength(1);
  });

  test('INSERT database gagal setelah Drive sukses: berkas Drive dibuang (trashFile) dan galat jelas', async () => {
    const realDb = env.DB;
    env.DB = {
      prepare: (sql: string) => {
        if (sql.startsWith('INSERT INTO files')) {
          return {
            bind: () => ({
              run: async () => {
                throw new Error('DB down');
              },
            }),
          };
        }
        return realDb.prepare(sql);
      },
      batch: realDb.batch.bind(realDb),
    } as unknown as Db;
    const error = await captureAppErrorAsync(() => up());
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('Gambar gagal disimpan. Coba unggah lagi.');
    const trashed = env.BRIDGE.calls.filter((c) => c.action === 'trashFile');
    expect(trashed).toHaveLength(1);
    const created = [...env.BRIDGE.state.files.values()];
    expect(created).toHaveLength(1);
    expect(created[0]?.trashed).toBe(true);
    env.DB = realDb;
    expect(await files()).toHaveLength(0);
  });

  test('trashFile ikut gagal: tetap galat jelas ke pengguna dan dicatat yatim', async () => {
    const realDb = env.DB;
    env.DB = {
      prepare: (sql: string) =>
        sql.startsWith('INSERT INTO files')
          ? {
              bind: () => ({
                run: async () => {
                  throw new Error('DB down');
                },
              }),
            }
          : realDb.prepare(sql),
      batch: realDb.batch.bind(realDb),
    } as unknown as Db;
    env.BRIDGE.failNext('trashFile', new Error('mati'));
    const error = await captureAppErrorAsync(() => up());
    expect(error.code).toBe('INTERNAL');
    expect(logged.some((line) => line.includes('yatim'))).toBe(true);
  });

  test('folder Drive dibuat sekali dan dipakai ulang (setup diulang, upload berturut-turut)', async () => {
    const first = await ensureDriveFolder(env);
    const second = await ensureDriveFolder(env);
    await up();
    await up(upload({ mime: 'image/jpeg', bytes: bytesOfBase64(JPEG) }));
    expect(second).toBe(first);
    expect(env.BRIDGE.state.folders.size).toBe(1);
    const setting = await env.DB.prepare(
      "SELECT value FROM settings WHERE `key` = 'DRIVE_FOLDER_ID'",
    ).first<{
      value: string;
    }>();
    expect(setting?.value).toBe(first);
    expect(DRIVE_FOLDER_NAME).toBe('QC App Files');
  });

  test('upload pertama tanpa setup membuat folder sendiri; dua upload serentak memakai folder yang sama', async () => {
    await Promise.all([up(), up()]);
    const setting = await env.DB.prepare(
      "SELECT value FROM settings WHERE `key` = 'DRIVE_FOLDER_ID'",
    ).first<{
      value: string;
    }>();
    expect(setting?.value).not.toBe('');
    const folders = new Set([...env.BRIDGE.state.files.values()].map((f) => f.folderId));
    expect(folders.size).toBe(1);
    expect(await files()).toHaveLength(2);
  });

  test('ensureDriveFolder TIDAK menimpa setting folder yang tidak dapat diakses (FS13)', async () => {
    const first = await ensureDriveFolder(env);
    env.BRIDGE.state.folders.delete(first);
    const error = await captureAppErrorAsync(() => ensureDriveFolder(env));
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('tidak dapat diakses');
    const setting = await env.DB.prepare(
      "SELECT value FROM settings WHERE `key` = 'DRIVE_FOLDER_ID'",
    ).first<{
      value: string;
    }>();
    expect(setting?.value).toBe(first);
    expect(env.BRIDGE.state.folders.size).toBe(0);
    env.BRIDGE.state.folders.add(first);
    expect(await ensureDriveFolder(env)).toBe(first);
  });

  test('ATTACHMENTS_FOLDER_ID dari .env dipakai langsung: tidak membuat folder, tidak menulis settings, dan hanya memverifikasi', async () => {
    const configured = { ...env, ATTACHMENTS_FOLDER_ID: 'IMAGESFOLDER001' };
    env.BRIDGE.state.folders.add('IMAGESFOLDER001');
    expect(await ensureDriveFolder(configured)).toBe('IMAGESFOLDER001');
    const saved = await uploadFile(configured, validateUploadFile(upload()), admin);
    uploadOrder.push(saved.id);
    expect([...env.BRIDGE.state.files.values()].map((f) => f.folderId)).toEqual([
      'IMAGESFOLDER001',
    ]);
    expect(env.BRIDGE.state.folders.size).toBe(1);
    const setting = await env.DB.prepare(
      "SELECT value FROM settings WHERE `key` = 'DRIVE_FOLDER_ID'",
    ).first<{ value: string }>();
    expect(setting).toBeNull();
    // Dibaca dari folder .env yang sama (bukan dari tabel settings yang kosong).
    expect(
      (await readFile(configured, { id: saved.id }, ALL_BU_VIEWER)).bytes.length,
    ).toBeGreaterThan(0);
    // Folder .env tak terjangkau: galat jelas, TIDAK membuat folder pengganti.
    env.BRIDGE.state.folders.delete('IMAGESFOLDER001');
    const error = await captureAppErrorAsync(() => ensureDriveFolder(configured));
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('tidak dapat diakses');
    expect(env.BRIDGE.state.folders.size).toBe(0);
    expect(env.BRIDGE.calls.filter((c) => c.action === 'createFolder')).toHaveLength(0);
  });

  test('batas berkas belum terpasang per user', async () => {
    const rows: DbStatement[] = [];
    for (let i = 0; i < MAX_UNATTACHED_UPLOADS; i++) {
      rows.push(
        env.DB.prepare(
          "INSERT INTO files (id, drive_id, created_by) VALUES (?, 'd', 'admin@gmail.com')",
        ).bind(`f${i}`),
      );
    }
    await env.DB.batch(rows);
    expect((await captureAppErrorAsync(() => up())).code).toBe('CONFLICT');
    // user lain tidak terkena
    await seedRole(env, { id: 'r', name: 'R', permissions: { item: 'edit' } });
    await seedUser(env, { id: 'u2', email: 'lain@gmail.com', roleIds: ['r'] });
    const lain = await loadUserContext(env, 'lain@gmail.com');
    await up(upload(), lain as UserContext);
    expect(await files()).toHaveLength(MAX_UNATTACHED_UPLOADS + 1);
  });
});

describe('baca', () => {
  test('readFile mengembalikan isi dari catatan database, id tak dikenal NOT_FOUND', async () => {
    const saved = await up();
    expect(await readFile(env, { id: saved.id }, ALL_BU_VIEWER)).toEqual({
      id: saved.id,
      mime: 'image/png',
      bytes: bytesOfBase64(PNG),
    });
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: 'tidak-ada' }, ALL_BU_VIEWER))).code,
    ).toBe('NOT_FOUND');
  });

  test('tidak pernah membaca Drive id yang tidak tercatat di tabel files', async () => {
    const folder = await ensureDriveFolder(env);
    const stray = await env.BRIDGE.createFile(folder, 'rahasia.png', 'image/png', PNG);
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: stray }, ALL_BU_VIEWER))).code,
    ).toBe('NOT_FOUND');
  });

  test('NOT_FOUND bila berkas Drive hilang atau dibuang', async () => {
    const saved = await up();
    env.BRIDGE.state.files.clear();
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: saved.id }, ALL_BU_VIEWER))).code,
    ).toBe('NOT_FOUND');
  });

  test('menolak berkas yang drive_id-nya bukan anak folder aplikasi', async () => {
    const saved = await up();
    const other = await env.BRIDGE.createFolder('Folder Lain');
    const foreign = await env.BRIDGE.createFile(other, 'luar.png', 'image/png', PNG);
    await env.DB.prepare(
      "INSERT INTO files (id, drive_id, mime, created_by) VALUES ('f-luar', ?, 'image/png', 'x')",
    )
      .bind(foreign)
      .run();
    expect((await readFile(env, { id: saved.id }, ALL_BU_VIEWER)).bytes).toEqual(
      bytesOfBase64(PNG),
    );
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: 'f-luar' }, ALL_BU_VIEWER))).code,
    ).toBe('NOT_FOUND');
  });

  test('jembatan gagal saat baca: UNAVAILABLE, bukan NOT_FOUND', async () => {
    const saved = await up();
    env.BRIDGE.failNext('readFile', new Error('timeout'));
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: saved.id }, ALL_BU_VIEWER))).code,
    ).toBe('UNAVAILABLE');
  });

  test('pengguna tanpa izin item hanya membaca logo bersama dan unggahan miliknya', async () => {
    const saved = await up();
    const logo = await up();
    await env.DB.prepare("UPDATE files SET owner_type = 'qrlogo', owner_id = 'shared' WHERE id = ?")
      .bind(logo.id)
      .run();
    expect((await captureAppErrorAsync(() => readFile(env, { id: saved.id }, NO_ITEM))).code).toBe(
      'NOT_FOUND',
    );
    expect((await readFile(env, { id: logo.id }, NO_ITEM)).bytes).toEqual(bytesOfBase64(PNG));
    expect((await readFile(env, { id: saved.id }, ALL_BU_VIEWER)).bytes).toEqual(
      bytesOfBase64(PNG),
    );
  });

  test('pembacaan kedua dari cache (tanpa jembatan); aturan akses diperiksa sebelum cache', async () => {
    const cache = new MemoryFileCache();
    env.FILE_CACHE = cache;
    const saved = await up();
    expect((await readFile(env, { id: saved.id }, ALL_BU_VIEWER)).bytes).toEqual(
      bytesOfBase64(PNG),
    );
    expect((await readFile(env, { id: saved.id }, ALL_BU_VIEWER)).bytes).toEqual(
      bytesOfBase64(PNG),
    );
    expect(env.BRIDGE.calls.filter((c) => c.action === 'readFile')).toHaveLength(1);
    expect((await captureAppErrorAsync(() => readFile(env, { id: saved.id }, NO_ITEM))).code).toBe(
      'NOT_FOUND',
    );
    expect(env.BRIDGE.calls.filter((c) => c.action === 'readFile')).toHaveLength(1);
  });

  test('cache terikat folder aktif: mengganti folder membuat isi lama tidak disajikan lagi', async () => {
    const cache = new MemoryFileCache();
    env.FILE_CACHE = cache;
    const saved = await up();
    await readFile(env, { id: saved.id }, ALL_BU_VIEWER);
    const [driveId] = [...env.BRIDGE.state.files.keys()];
    expect(
      cache.store.has(
        fileCacheKey(
          env.BRIDGE.state.files.get(driveId as string)?.folderId ?? '',
          driveId as string,
        ),
      ),
    ).toBe(true);
    await env.DB.prepare(
      "UPDATE settings SET value = 'folder-lain' WHERE `key` = 'DRIVE_FOLDER_ID'",
    ).run();
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: saved.id }, ALL_BU_VIEWER))).code,
    ).toBe('NOT_FOUND');
  });

  test('cache memori LRU: dibuang saat berkas dipurge dari Drive (dropCachedFile)', async () => {
    const cache = createMemoryFileCache(1_000_000);
    env.FILE_CACHE = cache;
    const saved = await up();
    await readFile(env, { id: saved.id }, ALL_BU_VIEWER);
    expect(cache.size).toBeGreaterThan(0);
    await env.DB.batch(markFilesPendingDelete(env, [saved.id]));
    await purgePendingFiles(env);
    expect(cache.size).toBe(0);
  });

  test('berkas pending_delete tidak terbaca', async () => {
    const saved = await up();
    await env.DB.batch(markFilesPendingDelete(env, [saved.id]));
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: saved.id }, ALL_BU_VIEWER))).code,
    ).toBe('NOT_FOUND');
  });
});

describe('berkas gambar item menurut BU', () => {
  let cache: MemoryFileCache;
  let fileA: string;
  let fileAB: string;
  let fileLogo: string;

  const own = (fileId: string, type: string, ownerId: string) =>
    env.DB.prepare('UPDATE files SET owner_type = ?, owner_id = ? WHERE id = ?')
      .bind(type, ownerId, fileId)
      .run();
  const driveReads = () => env.BRIDGE.calls.filter((c) => c.action === 'readFile').length;

  beforeEach(async () => {
    cache = new MemoryFileCache();
    env.FILE_CACHE = cache;
    await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
    await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B' });
    await seedBrand(env, 'Sony');
    await seedItem(env, { id: 'i-a', brand: 'Sony', model: 'Satu', businessUnitIds: ['bu-a'] });
    await seedItem(env, {
      id: 'i-ab',
      brand: 'Sony',
      model: 'Dua',
      businessUnitIds: ['bu-a', 'bu-b'],
    });
    fileA = (await up()).id;
    fileAB = (await up()).id;
    fileLogo = (await up()).id;
    await own(fileA, 'item', 'i-a');
    await own(fileAB, 'item', 'i-ab');
    await own(fileLogo, 'qrlogo', 'shared');
  });

  const viewer = (itemBuIds: readonly string[] | null) => ({
    email: 'x@gmail.com',
    itemBuIds,
    canReadStickerFiles: itemBuIds !== null,
  });

  test('item BU A: user BU A membaca; user BU B = NOT_FOUND dengan pesan sama dengan berkas tak ada', async () => {
    expect((await readFile(env, { id: fileA }, viewer(['bu-a']))).bytes).toEqual(
      bytesOfBase64(PNG),
    );
    const hidden = await captureAppErrorAsync(() => readFile(env, { id: fileA }, viewer(['bu-b'])));
    const missing = await captureAppErrorAsync(() =>
      readFile(env, { id: 'tidak-ada' }, viewer(['bu-b'])),
    );
    expect(hidden.code).toBe('NOT_FOUND');
    expect(hidden.message).toBe(missing.message);
  });

  test('item A+B: terbaca oleh user yang melihat salah satu BU-nya, tidak oleh BU lain atau himpunan kosong', async () => {
    expect((await readFile(env, { id: fileAB }, viewer(['bu-a']))).bytes).toEqual(
      bytesOfBase64(PNG),
    );
    expect((await readFile(env, { id: fileAB }, viewer(['bu-b']))).bytes).toEqual(
      bytesOfBase64(PNG),
    );
    for (const ids of [[], ['bu-lain']]) {
      expect(
        (await captureAppErrorAsync(() => readFile(env, { id: fileAB }, viewer(ids)))).code,
      ).toBe('NOT_FOUND');
    }
  });

  test('isi berkas tidak diambil dari cache maupun Drive bila BU tak cocok (diperiksa sebelum cache)', async () => {
    await readFile(env, { id: fileA }, viewer(['bu-a']));
    expect(driveReads()).toBe(1);
    const getsBefore = cache.gets;
    for (const ids of [['bu-b'], []]) {
      await captureAppErrorAsync(() => readFile(env, { id: fileA }, viewer(ids)));
    }
    expect(cache.gets).toBe(getsBefore);
    expect(driveReads()).toBe(1);
  });

  test('logo QR tetap terbaca tanpa izin item; unggahan sendiri yang belum terpasang tetap terbaca', async () => {
    const pending = await up(upload(), admin);
    expect((await readFile(env, { id: fileLogo }, viewer(null))).bytes).toEqual(bytesOfBase64(PNG));
    expect(
      (
        await readFile(
          env,
          { id: pending.id },
          { email: 'admin@gmail.com', itemBuIds: null, canReadStickerFiles: false },
        )
      ).bytes,
    ).toEqual(bytesOfBase64(PNG));
    // tanpa izin item: berkas item tetap tertutup, walau BU-nya "cocok" tidak relevan
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: fileA }, viewer(null)))).code,
    ).toBe('NOT_FOUND');
  });

  test('unggahan yang belum terpasang hanya terbaca pengunggahnya, juga bagi pemegang item:view; cache tak disajikan ke user lain', async () => {
    const pending = (await up(upload(), admin)).id;
    const mine = { email: 'admin@gmail.com', itemBuIds: ['bu-a'], canReadStickerFiles: true };
    expect((await readFile(env, { id: pending }, mine)).bytes).toEqual(bytesOfBase64(PNG));
    expect(driveReads()).toBe(1);
    const getsBefore = cache.gets;
    const missing = await captureAppErrorAsync(() =>
      readFile(env, { id: 'tidak-ada' }, viewer(['bu-a'])),
    );
    for (const ids of [['bu-a'], ['bu-a', 'bu-b'], [], null]) {
      const other = await captureAppErrorAsync(() => readFile(env, { id: pending }, viewer(ids)));
      expect(other.code).toBe('NOT_FOUND');
      expect(other.message).toBe(missing.message);
    }
    // ditolak sebelum cache/Drive disentuh
    expect(cache.gets).toBe(getsBefore);
    expect(driveReads()).toBe(1);
    // setelah terpasang pada item, user yang berhak BU membacanya seperti biasa
    await own(pending, 'item', 'i-a');
    expect((await readFile(env, { id: pending }, viewer(['bu-a']))).bytes).toEqual(
      bytesOfBase64(PNG),
    );
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: pending }, viewer(['bu-b'])))).code,
    ).toBe('NOT_FOUND');
  });

  test('lewat REST: pending hanya terbaca pengunggahnya; user item:view lain NOT_FOUND', async () => {
    await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
    await seedUser(env, {
      id: 'u-a',
      email: 'a@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
    });
    const pending = (await up(upload(), admin)).id;
    expect(await restCall(env, 'admin@gmail.com', 'files.get', { id: pending })).toMatchObject({
      ok: true,
    });
    expect(await restCall(env, 'a@gmail.com', 'files.get', { id: pending })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  test('jenis pemilik lain (logo) tidak dibatasi BU untuk pemegang izin item, termasuk himpunan BU kosong', async () => {
    expect((await readFile(env, { id: fileLogo }, viewer([]))).bytes).toEqual(bytesOfBase64(PNG));
  });

  test('lewat REST: user BU A membaca berkas item A; user BU B = NOT_FOUND; qrcode saja hanya logo', async () => {
    await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
    await seedRole(env, { id: 'r-qr', name: 'QR', permissions: { qrcode: 'view' } });
    await seedUser(env, {
      id: 'u-a',
      email: 'a@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
    });
    await seedUser(env, {
      id: 'u-b',
      email: 'b@gmail.com',
      buAssignments: [{ buId: 'bu-b', roleIds: ['r-view'] }],
    });
    await seedUser(env, { id: 'u-qr', email: 'qr@gmail.com', roleIds: ['r-qr'] });
    await seedUser(env, { id: 'u-n', email: 'tanpa@gmail.com' });
    const call = (id: string, email: string) => restCall(env, email, 'files.get', { id });
    expect(await call(fileA, 'a@gmail.com')).toMatchObject({ ok: true });
    expect(await call(fileA, 'b@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await call(fileAB, 'b@gmail.com')).toMatchObject({ ok: true });
    expect(await call(fileLogo, 'qr@gmail.com')).toMatchObject({ ok: true });
    expect(await call(fileA, 'qr@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await call(fileA, 'tanpa@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await call(fileA, 'admin@gmail.com')).toMatchObject({ ok: true });
  });

  test('pencabutan BU berlaku seketika pada pembacaan berkas (konteks dimuat per permintaan)', async () => {
    await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
    await seedUser(env, {
      id: 'u-a',
      email: 'a@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
    });
    expect(await restCall(env, 'a@gmail.com', 'files.get', { id: fileA })).toMatchObject({
      ok: true,
    });
    await env.DB.prepare(
      'UPDATE users SET bu_assignments = \'[{"buId":"bu-b","roleIds":["r-view"]}]\' WHERE id = \'u-a\'',
    ).run();
    expect(await restCall(env, 'a@gmail.com', 'files.get', { id: fileA })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('validasi', () => {
  test('menolak MIME, byte, tanda tangan, ukuran, dan dimensi yang salah', () => {
    const fieldsOf = (input: unknown) => captureAppError(() => validateUploadFile(input)).fields;
    expect(fieldsOf(upload({ mime: 'image/gif' }))?.mime).toBe('Hanya JPEG, PNG, atau WebP');
    expect(fieldsOf(upload({ mime: 'text/html' }))?.mime).toBeDefined();
    expect(fieldsOf(upload({ bytes: 'bukan byte' }))?.bytes).toBe('Isi gambar tidak valid');
    expect(fieldsOf(upload({ bytes: new Uint8Array() }))?.bytes).toBe('Isi gambar tidak valid');
    expect(fieldsOf(upload({ mime: 'image/jpeg' }))?.bytes).toBe(
      'Isi berkas tidak sesuai jenis gambar',
    );
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    huge.set(bytesOfBase64(PNG));
    expect(fieldsOf(upload({ bytes: huge }))?.bytes).toBe('Ukuran gambar maksimal 10 MB');
    for (const bad of [0, -1, 4001, 1.5, '1', null]) {
      expect(fieldsOf(upload({ width: bad }))?.width).toBeDefined();
      expect(fieldsOf(upload({ height: bad }))?.height).toBeDefined();
    }
    expect(fieldsOf('teks')?._).toBe('Input harus berupa objek');
  });

  test('validateGetFile mewajibkan id', () => {
    expect(validateGetFile({ id: 'f1' })).toEqual({ id: 'f1' });
    expect(captureAppError(() => validateGetFile({ id: '' })).fields).toEqual({
      id: 'Wajib diisi',
    });
  });
});

describe('attachFiles', () => {
  test('menetapkan pemilik sekali; pemilik lain CONFLICT; id tak dikenal VALIDATION', async () => {
    const a = await up();
    const b = await up();
    await attachFiles(env, [a.id, b.id], 'item', 'item-1');
    expect((await files()).map((f) => [f.owner_type, f.owner_id])).toEqual([
      ['item', 'item-1'],
      ['item', 'item-1'],
    ]);
    await attachFiles(env, [a.id], 'item', 'item-1');
    expect(
      (await captureAppErrorAsync(() => attachFiles(env, [a.id], 'item', 'item-2'))).code,
    ).toBe('CONFLICT');
    expect(
      (await captureAppErrorAsync(() => attachFiles(env, ['hilang'], 'item', 'item-1'))).code,
    ).toBe('VALIDATION');
    await attachFiles(env, [], 'item', 'item-1');
  });

  test('atomik: batch yang gagal tidak mengubah pemilik berkas mana pun; ulang yang sah berhasil', async () => {
    const a = await up();
    const b = await up();
    const taken = await up();
    await attachFiles(env, [taken.id], 'item', 'item-lain');
    expect(
      (await captureAppErrorAsync(() => attachFiles(env, [a.id, 'hilang'], 'item', 'item-1'))).code,
    ).toBe('VALIDATION');
    expect(
      (await captureAppErrorAsync(() => attachFiles(env, [a.id, b.id, taken.id], 'item', 'item-1')))
        .code,
    ).toBe('CONFLICT');
    expect(
      (await files()).map((f) => [f.id === taken.id ? 'taken' : 'bebas', f.owner_type]),
    ).toEqual([
      ['bebas', ''],
      ['bebas', ''],
      ['taken', 'item'],
    ]);
    await attachFiles(env, [a.id, b.id], 'item', 'item-1');
    expect((await files()).filter((f) => f.owner_id === 'item-1')).toHaveLength(2);
  });

  test('claimant: unggahan belum terpasang milik orang lain = VALIDATION seperti berkas tak dikenal; milik sendiri dipasang', async () => {
    const mine = await up();
    const unknown = await captureAppErrorAsync(() =>
      planAttachFiles(env, ['hilang'], 'item', 'item-1', undefined, 'admin@gmail.com'),
    );
    const others = await captureAppErrorAsync(() =>
      planAttachFiles(env, [mine.id], 'item', 'item-1', undefined, 'lain@gmail.com'),
    );
    expect(others.code).toBe('VALIDATION');
    expect(others.message).toBe(unknown.message);
    expect((await files())[0]?.owner_type).toBe('');
    expect(
      await planAttachFiles(env, [mine.id], 'item', 'item-1', undefined, 'admin@gmail.com'),
    ).toHaveLength(1);
  });

  test('menerima id ganda; planAttachFiles menghasilkan pernyataan untuk batch pemanggil', async () => {
    const a = await up();
    const statements = await planAttachFiles(env, [a.id, a.id], 'item', 'item-1');
    expect(statements).toHaveLength(1);
    expect((await files())[0]?.owner_id).toBe('');
    await env.DB.batch(statements);
    expect((await files())[0]?.owner_id).toBe('item-1');
  });
});

describe('penghapusan (pending_delete)', () => {
  test('tandai di database, buang di Drive, lalu hapus baris', async () => {
    const a = await up();
    await deleteFiles(env, [a.id]);
    expect(await files()).toHaveLength(0);
    expect([...env.BRIDGE.state.files.values()][0]?.trashed).toBe(true);
  });

  test('jembatan gagal: baris tetap pending_delete (tidak hilang), cron mengulang', async () => {
    const a = await up();
    env.BRIDGE.failNext('trashFile', new Error('mati'));
    await deleteFiles(env, [a.id]);
    expect((await files()).map((f) => f.status)).toEqual(['pending_delete']);
    expect(await purgePendingFiles(env)).toBe(1);
    expect(await files()).toHaveLength(0);
  });
});

describe('rute dan izin', () => {
  async function call(method: string, payload: unknown, email: string) {
    return restCall(env, email, method, payload);
  }

  test('upload butuh item edit, baca butuh item view, dan lintas peran ditolak', async () => {
    await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
    await seedRole(env, { id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } });
    await seedUser(env, { id: 'u-v', email: 'lihat@gmail.com', roleIds: ['r-view'] });
    await seedUser(env, { id: 'u-e', email: 'ubah@gmail.com', roleIds: ['r-edit'] });
    await seedUser(env, { id: 'u-n', email: 'tanpa@gmail.com' });
    const saved = await call('files.upload', upload(), 'ubah@gmail.com');
    expect(saved.ok).toBe(true);
    const id = saved.ok ? (saved.data as { id: string }).id : '';
    expect(await call('files.upload', upload(), 'lihat@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await call('files.upload', upload(), 'tanpa@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    // unggahan yang belum terpasang hanya terbaca pengunggahnya; setelah terpasang pada item, pemegang item:view membacanya
    expect(await call('files.get', { id }, 'lihat@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await call('files.get', { id }, 'ubah@gmail.com')).toMatchObject({ ok: true });
    await seedBrand(env, 'Sony');
    await seedItem(env, { id: 'i-rute', brand: 'Sony', model: 'Rute' });
    await env.DB.prepare("UPDATE files SET owner_type = 'item', owner_id = 'i-rute' WHERE id = ?")
      .bind(id)
      .run();
    expect(await call('files.get', { id }, 'lihat@gmail.com')).toMatchObject({
      ok: true,
      data: { mime: 'image/png', bytes: bytesOfBase64(PNG) },
    });
    expect(await call('files.get', { id }, 'tanpa@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  test('galat jembatan tampil sebagai UNAVAILABLE (503) lewat REST', async () => {
    await ensureDriveFolder(env);
    env.BRIDGE.failNext('createFile', new Error('x'));
    expect(await call('files.upload', upload(), 'admin@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
  });
});

describe('pagar base64', () => {
  test('pagar: tidak ada atob/btoa/Buffer base64 di server/src selain token kecil (base64url.ts) dan core/bytes.ts', () => {
    const root = join(import.meta.dir, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
          const rel = relative(root, path).split('\\').join('/');
          if (rel === 'core/base64url.ts') continue; // token sesi/OAuth saja, bukan isi berkas
          if (rel === 'core/bytes.ts') continue; // satu-satunya konversi byte <-> base64 isi berkas
          const text = readFileSync(path, 'utf8');
          if (/\b(atob|btoa)\s*\(|Buffer\.from\([^)]*base64|toBase64|fromBase64/.test(text)) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
