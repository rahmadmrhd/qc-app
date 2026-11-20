import { beforeEach, describe, expect, test } from 'bun:test';
import { createMemoryFileCache, fileCacheKey } from '@server/core/file-cache';
import { loadUserContext } from '@server/modules/access/context';
import { ensureQrFolder } from '@server/modules/qrcode/folders';
import { readQrFile } from '@server/modules/qrcode/service';
import { bytesOfBase64 } from '@server-test/bytes';
import { qrCall, seedQrEnv } from '@server-test/qrcode-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

const PDF1 = 'JVBERi0xLjQK';
const PDF2 = 'JVBERi0xLjUK';

let env: TestEnv;
let cache: ReturnType<typeof createMemoryFileCache>;

const reads = () => env.BRIDGE.calls.filter((c) => c.action === 'readFile').length;

beforeEach(async () => {
  cache = createMemoryFileCache(1_000_000);
  env = await createTestEnv({ FILE_CACHE: cache });
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  await seedQrEnv(env);
});

async function viewer() {
  const user = await loadUserContext(env, 'qrview@gmail.com');
  if (!user) throw new Error('pengguna uji tidak ada');
  return user;
}

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

describe('cache memori untuk berkas ekspor QR dan penggantian isi', () => {
  test('qrcodes.file: miss ke jembatan sekali, lalu hit dengan mime tersimpan', async () => {
    await exportedDesign();
    const first = await readQrFile(env, { id: 'd1', kind: 'pdf' }, await viewer());
    const second = await readQrFile(env, { id: 'd1', kind: 'pdf' }, await viewer());
    expect(first.bytes).toEqual(bytesOfBase64(PDF1));
    expect(second).toEqual(first);
    expect(second.mime).toBe('application/pdf');
    expect(reads()).toBe(1);
  });

  test('qrcodes.file lewat router: tanpa izin qrcode tidak mendapat isi dari cache', async () => {
    await exportedDesign();
    await readQrFile(env, { id: 'd1', kind: 'pdf' }, await viewer());
    const out = await qrCall(env, 'noqr@gmail.com', 'qrcodes.file', { id: 'd1', kind: 'pdf' });
    expect(out.ok).toBe(false);
    const ok = await qrCall(env, 'qrview@gmail.com', 'qrcodes.file', { id: 'd1', kind: 'pdf' });
    expect(ok.ok).toBe(true);
    expect(reads()).toBe(1);
  });

  test('unggah ulang PDF (replaceFileContent): salinan lama dibuang dan tidak dikembalikan', async () => {
    const first = await qrCall(env, 'qredit@gmail.com', 'qrcodes.uploadPdf', {
      name: 'm.pdf',
      bytes: bytesOfBase64(PDF1),
    });
    const driveId =
      (
        await env.DB.prepare('SELECT drive_id FROM qr_documents WHERE id = ?')
          .bind(first.data.id)
          .first<{ drive_id: string }>()
      )?.drive_id ?? '';
    // salinan lama di cache (mis. dari pembacaan sebelumnya), terikat folder dokumen aktif
    const folderId = env.BRIDGE.state.files.get(driveId)?.folderId ?? '';
    await cache.put(fileCacheKey(folderId, driveId), 'application/pdf', PDF1);
    expect(cache.size).toBeGreaterThan(0);
    const second = await qrCall(env, 'qredit@gmail.com', 'qrcodes.uploadPdf', {
      name: 'm.pdf',
      bytes: bytesOfBase64(PDF2),
      replaceDocumentId: first.data.id,
    });
    expect(second.ok).toBe(true);
    expect(cache.size).toBe(0);
  });
});
