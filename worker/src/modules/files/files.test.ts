import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MAX_IMAGE_BYTES, MAX_UNATTACHED_UPLOADS } from '@shared/files';
import type { FileCache } from '@worker/core/file-cache';
import { fileCacheKey } from '@worker/core/file-cache';
import { callRoute } from '@worker/core/router';
import { signSessionToken } from '@worker/core/session';
import type { UserContext } from '@worker/modules/access/context';
import { loadUserContext } from '@worker/modules/access/context';
import { getRoutes } from '@worker/routes';
import { seedRole, seedUser } from '@worker-test/access-fixtures';
import { captureAppError, captureAppErrorAsync } from '@worker-test/errors';
import { measureCpu } from '@worker-test/measure';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
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
const JPEG = '/9j/4AAQSkZJRg==';

let env: TestEnv;
let admin: UserContext;
const realError = console.error;
let logged: string[];

const upload = (overrides: Record<string, unknown> = {}) => ({
  mime: 'image/png',
  base64: PNG,
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
    'SELECT id, drive_id, owner_type, owner_id, created_by, created_at, status FROM files ORDER BY rowid',
  ).all<{
    id: string;
    drive_id: string;
    owner_type: string;
    owner_id: string;
    created_by: string;
    created_at: string;
    status: string;
  }>();
  return rows.results;
}

async function up(input = upload(), actor = admin) {
  return uploadFile(env, validateUploadFile(input), actor);
}

beforeEach(async () => {
  logged = [];
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

  test('urutan Drive dulu, lalu D1: jembatan gagal = tidak ada baris files, galat UNAVAILABLE jelas', async () => {
    await ensureDriveFolder(env);
    env.BRIDGE.failNext('createFile', new Error('Apps Script 500'));
    const error = await captureAppErrorAsync(() => up());
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toContain('Google Drive');
    expect(await files()).toHaveLength(0);
    expect(env.BRIDGE.state.files.size).toBe(0);
    // ulang aman
    await up();
    expect(await files()).toHaveLength(1);
  });

  test('INSERT D1 gagal setelah Drive sukses: berkas Drive dibuang (trashFile) dan galat jelas', async () => {
    const realDb = env.DB;
    env.DB = {
      prepare: (sql: string) => {
        if (sql.startsWith('INSERT INTO files')) {
          return {
            bind: () => ({
              run: async () => {
                throw new Error('D1 down');
              },
            }),
          };
        }
        return realDb.prepare(sql);
      },
      batch: realDb.batch.bind(realDb),
    } as unknown as D1Database;
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
                  throw new Error('D1 down');
                },
              }),
            }
          : realDb.prepare(sql),
      batch: realDb.batch.bind(realDb),
    } as unknown as D1Database;
    env.BRIDGE.failNext('trashFile', new Error('mati'));
    const error = await captureAppErrorAsync(() => up());
    expect(error.code).toBe('INTERNAL');
    expect(logged.some((line) => line.includes('yatim'))).toBe(true);
  });

  test('folder Drive dibuat sekali dan dipakai ulang (setup diulang, upload berturut-turut)', async () => {
    const first = await ensureDriveFolder(env);
    const second = await ensureDriveFolder(env);
    await up();
    await up(upload({ mime: 'image/jpeg', base64: JPEG }));
    expect(second).toBe(first);
    expect(env.BRIDGE.state.folders.size).toBe(1);
    const setting = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'DRIVE_FOLDER_ID'",
    ).first<{
      value: string;
    }>();
    expect(setting?.value).toBe(first);
    expect(DRIVE_FOLDER_NAME).toBe('QC App Files');
  });

  test('upload pertama tanpa setup membuat folder sendiri; dua upload serentak memakai folder yang sama', async () => {
    await Promise.all([up(), up()]);
    const setting = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'DRIVE_FOLDER_ID'",
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
      "SELECT value FROM settings WHERE key = 'DRIVE_FOLDER_ID'",
    ).first<{
      value: string;
    }>();
    expect(setting?.value).toBe(first);
    expect(env.BRIDGE.state.folders.size).toBe(0);
    env.BRIDGE.state.folders.add(first);
    expect(await ensureDriveFolder(env)).toBe(first);
  });

  test('batas berkas belum terpasang per user', async () => {
    const rows: D1PreparedStatement[] = [];
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
  test('readFile mengembalikan isi dari catatan D1, id tak dikenal NOT_FOUND', async () => {
    const saved = await up();
    expect(await readFile(env, { id: saved.id })).toEqual({
      id: saved.id,
      mime: 'image/png',
      base64: PNG,
    });
    expect((await captureAppErrorAsync(() => readFile(env, { id: 'tidak-ada' }))).code).toBe(
      'NOT_FOUND',
    );
  });

  test('tidak pernah membaca Drive id yang tidak tercatat di tabel files', async () => {
    const folder = await ensureDriveFolder(env);
    const stray = await env.BRIDGE.createFile(folder, 'rahasia.png', 'image/png', PNG);
    expect((await captureAppErrorAsync(() => readFile(env, { id: stray }))).code).toBe('NOT_FOUND');
  });

  test('NOT_FOUND bila berkas Drive hilang atau dibuang', async () => {
    const saved = await up();
    env.BRIDGE.state.files.clear();
    expect((await captureAppErrorAsync(() => readFile(env, { id: saved.id }))).code).toBe(
      'NOT_FOUND',
    );
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
    expect((await readFile(env, { id: saved.id })).base64).toBe(PNG);
    expect((await captureAppErrorAsync(() => readFile(env, { id: 'f-luar' }))).code).toBe(
      'NOT_FOUND',
    );
  });

  test('jembatan gagal saat baca: UNAVAILABLE, bukan NOT_FOUND', async () => {
    const saved = await up();
    env.BRIDGE.failNext('readFile', new Error('timeout'));
    expect((await captureAppErrorAsync(() => readFile(env, { id: saved.id }))).code).toBe(
      'UNAVAILABLE',
    );
  });

  test('pengguna tanpa izin item hanya membaca logo bersama dan unggahan miliknya', async () => {
    const saved = await up();
    const logo = await up();
    await env.DB.prepare("UPDATE files SET owner_type = 'qrlogo', owner_id = 'shared' WHERE id = ?")
      .bind(logo.id)
      .run();
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: saved.id }, 'lain@gmail.com'))).code,
    ).toBe('NOT_FOUND');
    expect((await readFile(env, { id: logo.id }, 'lain@gmail.com')).base64).toBe(PNG);
    expect((await readFile(env, { id: saved.id }, 'admin@gmail.com')).base64).toBe(PNG);
  });

  test('pembacaan kedua dari cache (tanpa jembatan); aturan akses diperiksa sebelum cache', async () => {
    const cache = new MemoryFileCache();
    env.FILE_CACHE = cache;
    const saved = await up();
    expect((await readFile(env, { id: saved.id })).base64).toBe(PNG);
    expect((await readFile(env, { id: saved.id })).base64).toBe(PNG);
    expect(env.BRIDGE.calls.filter((c) => c.action === 'readFile')).toHaveLength(1);
    expect(
      (await captureAppErrorAsync(() => readFile(env, { id: saved.id }, 'lain@gmail.com'))).code,
    ).toBe('NOT_FOUND');
    expect(env.BRIDGE.calls.filter((c) => c.action === 'readFile')).toHaveLength(1);
  });

  test('cache terikat folder aktif: mengganti folder membuat isi lama tidak disajikan lagi', async () => {
    const cache = new MemoryFileCache();
    env.FILE_CACHE = cache;
    const saved = await up();
    await readFile(env, { id: saved.id });
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
      "UPDATE settings SET value = 'folder-lain' WHERE key = 'DRIVE_FOLDER_ID'",
    ).run();
    expect((await captureAppErrorAsync(() => readFile(env, { id: saved.id }))).code).toBe(
      'NOT_FOUND',
    );
  });

  test('berkas pending_delete tidak terbaca', async () => {
    const saved = await up();
    await env.DB.batch(markFilesPendingDelete(env, [saved.id]));
    expect((await captureAppErrorAsync(() => readFile(env, { id: saved.id }))).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('validasi', () => {
  test('menolak MIME, base64, tanda tangan, ukuran, dan dimensi yang salah', () => {
    const fieldsOf = (input: unknown) => captureAppError(() => validateUploadFile(input)).fields;
    expect(fieldsOf(upload({ mime: 'image/gif' }))?.mime).toBe('Hanya JPEG, PNG, atau WebP');
    expect(fieldsOf(upload({ mime: 'text/html' }))?.mime).toBeDefined();
    expect(fieldsOf(upload({ base64: 'bukan base64!' }))?.base64).toBe('Isi gambar tidak valid');
    expect(fieldsOf(upload({ base64: `data:image/png;base64,${PNG}` }))?.base64).toBe(
      'Isi gambar tidak valid',
    );
    expect(fieldsOf(upload({ mime: 'image/jpeg' }))?.base64).toBe(
      'Isi berkas tidak sesuai jenis gambar',
    );
    const huge = `iVBORw0KGgo${'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8)}`;
    expect(
      fieldsOf(upload({ base64: huge.slice(0, huge.length - (huge.length % 4)) }))?.base64,
    ).toBe('Ukuran gambar maksimal 1 MB');
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
  test('tandai di D1, buang di Drive, lalu hapus baris', async () => {
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
    return callRoute(
      env,
      await signSessionToken(env, email, env.clock.now()),
      method,
      payload,
      getRoutes(),
    );
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
    expect(await call('files.get', { id }, 'lihat@gmail.com')).toMatchObject({
      ok: true,
      data: { mime: 'image/png', base64: PNG },
    });
    expect(await call('files.get', { id }, 'tanpa@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  test('galat jembatan tampil sebagai UNAVAILABLE (503) lewat RPC', async () => {
    await ensureDriveFolder(env);
    env.BRIDGE.failNext('createFile', new Error('x'));
    expect(await call('files.upload', upload(), 'admin@gmail.com')).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });
  });
});

describe('anggaran CPU dan pagar base64', () => {
  test('CPU kasar: unggah gambar ~1 MB (validasi + jembatan palsu + D1) di bawah anggaran', async () => {
    const bytes = 1_000_000;
    const base64 = `iVBORw0KGgo${'A'.repeat(Math.ceil((bytes * 4) / 3) - 11)}`;
    const padded = base64.slice(0, base64.length - (base64.length % 4));
    await ensureDriveFolder(env);
    const { ms } = await measureCpu(async () => {
      const input = validateUploadFile(upload({ base64: padded }));
      await uploadFile(env, input, admin);
    });
    expect(ms).toBeLessThan(30);
  });

  test('pagar: tidak ada atob/btoa/Buffer base64 di worker/src selain token kecil (base64url.ts)', () => {
    const root = join(import.meta.dir, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
          const rel = relative(root, path).split('\\').join('/');
          if (rel === 'core/base64url.ts') continue; // token sesi/OAuth saja, bukan isi berkas
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
