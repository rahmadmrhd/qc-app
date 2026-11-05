import { beforeEach, describe, expect, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { ensureQrFolder } from '@server/modules/qrcode/folders';
import { readQrFile } from '@server/modules/qrcode/service';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { FakeR2 } from '@server-test/fake-r2';
import { qrRpc, seedQrEnv } from '@server-test/qrcode-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { markFilesPendingDelete, purgePendingFiles, readFile, uploadFile } from './service';

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
const PDF1 = 'JVBERi0xLjQK';
const PDF2 = 'JVBERi0xLjUK';

let env: TestEnv;
let r2: FakeR2;
let admin: UserContext;

const reads = () => env.BRIDGE.calls.filter((c) => c.action === 'readFile').length;
const up = () => uploadFile(env, { mime: 'image/png', base64: PNG, width: 1, height: 1 }, admin);
const driveIdOf = async (id: string) =>
  (
    await env.DB.prepare('SELECT drive_id FROM files WHERE id = ?')
      .bind(id)
      .first<{ drive_id: string }>()
  )?.drive_id ?? '';

beforeEach(async () => {
  r2 = new FakeR2();
  // FILE_CACHE tidak diisi: jalur nyata memakai binding R2.
  env = await createTestEnv({ FILES_CACHE: r2.asBucket() });
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

describe('cache isi berkas di R2', () => {
  test('miss: jembatan dipanggil sekali lalu disimpan; berikutnya hit tanpa jembatan', async () => {
    const saved = await up();
    expect((await readFile(env, { id: saved.id })).base64).toBe(PNG);
    expect(reads()).toBe(1);
    const driveId = await driveIdOf(saved.id);
    const object = r2.objects.get(`f/${driveId}`);
    expect(object?.body).toBe(PNG);
    expect(object?.customMetadata.mime).toBe('image/png');
    expect((await readFile(env, { id: saved.id })).base64).toBe(PNG);
    expect(reads()).toBe(1);
  });

  test('izin diperiksa sebelum cache: pengguna tanpa izin tidak mendapat isi dari cache', async () => {
    const saved = await up();
    await readFile(env, { id: saved.id }); // cache terisi
    const getsBefore = r2.gets;
    const error = await captureAppErrorAsync(() =>
      readFile(env, { id: saved.id }, 'lain@gmail.com'),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(r2.gets).toBe(getsBefore); // R2 bahkan tidak dibaca
  });

  test('lewat router: tanpa izin ditolak walau isi ada di R2', async () => {
    const saved = await up();
    await readFile(env, { id: saved.id });
    await seedRole(env, { id: 'r-none', name: 'Tanpa', permissions: {} });
    await seedUser(env, { id: 'u-none', email: 'none@gmail.com', roleIds: ['r-none'] });
    const out = await qrRpc(env, 'none@gmail.com', 'files.get', { id: saved.id });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain(PNG);
  });

  test('folder berbeda dari folder aktif = miss (isi lama tidak disajikan)', async () => {
    const saved = await up();
    await readFile(env, { id: saved.id });
    await env.DB.prepare(
      "UPDATE settings SET value = 'folder-lain' WHERE key = 'DRIVE_FOLDER_ID'",
    ).run();
    expect((await captureAppErrorAsync(() => readFile(env, { id: saved.id }))).code).toBe(
      'NOT_FOUND',
    );
  });

  test('galat R2 (baca dan tulis) tidak menggagalkan permintaan: dilayani dari jembatan', async () => {
    const saved = await up();
    r2.failing = true;
    expect((await readFile(env, { id: saved.id })).base64).toBe(PNG);
    expect((await readFile(env, { id: saved.id })).base64).toBe(PNG);
    expect(reads()).toBe(2);
  });

  test('tanpa binding R2: perilaku lama (tidak ada cache, jembatan tiap baca)', async () => {
    const plain = await createTestEnv({ FILE_CACHE: null });
    const ctx = await loadUserContext(plain, 'admin@gmail.com');
    const saved = await uploadFile(
      plain,
      { mime: 'image/png', base64: PNG, width: 1, height: 1 },
      ctx as UserContext,
    );
    await readFile(plain, { id: saved.id });
    await readFile(plain, { id: saved.id });
    expect(plain.BRIDGE.calls.filter((c) => c.action === 'readFile')).toHaveLength(2);
  });

  test('WAIT_UNTIL tersedia: penyimpanan berjalan di latar dan respons tidak menunggu', async () => {
    const pending: Promise<unknown>[] = [];
    env.WAIT_UNTIL = (promise) => {
      pending.push(promise);
    };
    const saved = await up();
    await readFile(env, { id: saved.id });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(r2.puts).toBe(1);
  });

  test('hapus: pembuangan berkas (pending_delete lalu purge) membuang objek R2', async () => {
    const saved = await up();
    await readFile(env, { id: saved.id });
    const driveId = await driveIdOf(saved.id);
    expect(r2.objects.has(`f/${driveId}`)).toBe(true);
    await env.DB.batch(markFilesPendingDelete(env, [saved.id]));
    await purgePendingFiles(env);
    expect(r2.objects.has(`f/${driveId}`)).toBe(false);
  });

  test('galat R2 saat membuang tidak menggagalkan pembuangan berkas', async () => {
    const saved = await up();
    await readFile(env, { id: saved.id });
    r2.failing = true;
    await env.DB.batch(markFilesPendingDelete(env, [saved.id]));
    expect(await purgePendingFiles(env)).toBe(1);
  });
});

describe('cache R2 untuk berkas ekspor QR dan penggantian isi', () => {
  beforeEach(async () => {
    await seedQrEnv(env);
  });

  async function exportedDesign(): Promise<string> {
    const folder = await ensureQrFolder(env);
    const driveId = await env.BRIDGE.createFile(folder, 'x.pdf', 'application/pdf', PDF1);
    await env.DB.prepare(
      "INSERT INTO qr_designs (id, title, link_source, link, layout, style, export_pdf_drive_id, created_at, updated_at) VALUES ('d1', 'Judul', 'url', 'https://x.id', '{}', '{}', ?, '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:00.000Z')",
    )
      .bind(driveId)
      .run();
    return driveId;
  }

  test('qrcodes.file: miss ke jembatan sekali, lalu hit dengan mime tersimpan', async () => {
    const driveId = await exportedDesign();
    const first = await readQrFile(env, { id: 'd1', kind: 'pdf' });
    const second = await readQrFile(env, { id: 'd1', kind: 'pdf' });
    expect(first.base64).toBe(PDF1);
    expect(second).toEqual(first);
    expect(second.mime).toBe('application/pdf');
    expect(reads()).toBe(1);
    expect(r2.objects.get(`f/${driveId}`)?.customMetadata.mime).toBe('application/pdf');
  });

  test('qrcodes.file lewat router: tanpa izin qrcode tidak mendapat isi dari cache', async () => {
    await exportedDesign();
    await readQrFile(env, { id: 'd1', kind: 'pdf' });
    const out = await qrRpc(env, 'noqr@gmail.com', 'qrcodes.file', { id: 'd1', kind: 'pdf' });
    expect(out.ok).toBe(false);
    const ok = await qrRpc(env, 'qrview@gmail.com', 'qrcodes.file', { id: 'd1', kind: 'pdf' });
    expect(ok.ok).toBe(true);
    expect(reads()).toBe(1);
  });

  test('unggah ulang PDF (replaceFileContent): salinan lama dibuang dan tidak dikembalikan', async () => {
    const first = await qrRpc(env, 'qredit@gmail.com', 'qrcodes.uploadPdf', {
      name: 'm.pdf',
      base64: PDF1,
    });
    const driveId =
      (
        await env.DB.prepare('SELECT drive_id FROM qr_documents WHERE id = ?')
          .bind(first.data.id)
          .first<{ drive_id: string }>()
      )?.drive_id ?? '';
    // salinan lama di R2 (mis. dari pembacaan sebelumnya)
    await r2.put(`f/${driveId}`, PDF1, {
      customMetadata: { mime: 'application/pdf', folder: 'x' },
    });
    const second = await qrRpc(env, 'qredit@gmail.com', 'qrcodes.uploadPdf', {
      name: 'm.pdf',
      base64: PDF2,
      replaceDocumentId: first.data.id,
    });
    expect(second.ok).toBe(true);
    expect(r2.objects.has(`f/${driveId}`)).toBe(false);
  });
});
