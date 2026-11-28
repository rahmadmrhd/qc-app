import { beforeEach, describe, expect, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { ensureBlobFolder, getBlob, storeBlob } from './blob-store';
import { sha256Hex } from './hash';
import { BLOB_ORPHAN_GRACE_MS, sweepOrphanBlobs } from './sweep';
import {
  finishClUpload,
  putClUploadChunk,
  startClUpload,
  validateChunkClUpload,
  validateFinishClUpload,
  validateStartClUpload,
} from './upload-service';

let env: TestEnv;
const OWNER = { email: 'admin@gmail.com' };
const T0 = Date.parse('2026-11-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(T0);
});

const bytesOf = (seed: number) => Uint8Array.from([seed, seed + 1, seed + 2, seed + 3]);

async function upload(path: string, bytes: Uint8Array): Promise<string> {
  const sha256 = await sha256Hex(bytes);
  const session = await startClUpload(
    env,
    validateStartClUpload({ path, role: 'router', size: bytes.length, sha256 }),
    OWNER,
    { chunkBytes: 4 },
  );
  await putClUploadChunk(
    env,
    validateChunkClUpload({ id: session.uploadId, idx: '0', bytes }),
    OWNER,
  );
  await finishClUpload(env, validateFinishClUpload({ id: session.uploadId }), OWNER);
  return sha256;
}

const driveFile = (id: string) => env.BRIDGE.state.files.get(id);
const blobRow = async (sha256: string) => getBlob(env, sha256);
const later = (ms: number) => env.clock.set(T0 + ms);

describe('sweepOrphanBlobs: baris katalog', () => {
  test('biner tak dirujuk apa pun dan lewat masa tenggang disapu (baris + berkas Drive); idempoten', async () => {
    const sha = await sha256Hex(bytesOf(10));
    await storeBlob(env, { sha256: sha, bytes: bytesOf(10) });
    const driveId = (await blobRow(sha))?.driveFileId ?? '';
    later(BLOB_ORPHAN_GRACE_MS + DAY);
    expect(await sweepOrphanBlobs(env)).toEqual({ blobs: 1, driveFiles: 1 });
    expect(await blobRow(sha)).toBeNull();
    expect(driveFile(driveId)).toBeUndefined();
    expect(await sweepOrphanBlobs(env)).toEqual({ blobs: 0, driveFiles: 0 });
  });

  test('biner yang masih dalam masa tenggang tidak disentuh', async () => {
    const sha = await sha256Hex(bytesOf(10));
    await storeBlob(env, { sha256: sha, bytes: bytesOf(10) });
    later(BLOB_ORPHAN_GRACE_MS - DAY);
    expect(await sweepOrphanBlobs(env)).toEqual({ blobs: 0, driveFiles: 0 });
    expect(await blobRow(sha)).not.toBeNull();
  });

  test('biner revisi terbaru DAN biner yang hanya dirujuk revisi lama tetap ada', async () => {
    const first = await upload('os/a.npk', bytesOf(20));
    env.clock.set(T0 + 1000);
    const second = await upload('os/a.npk', bytesOf(40)); // revisi 2; revisi 1 masih merujuk `first`
    later(BLOB_ORPHAN_GRACE_MS + 10 * DAY);
    expect(await sweepOrphanBlobs(env)).toEqual({ blobs: 0, driveFiles: 0 });
    expect(await blobRow(first)).not.toBeNull();
    expect(await blobRow(second)).not.toBeNull();
  });

  test('biner yang dirujuk berkas bundel terbit tetap ada walau tak ada revisi yang merujuknya', async () => {
    const sha = await sha256Hex(bytesOf(30));
    await storeBlob(env, { sha256: sha, bytes: bytesOf(30) });
    const now = new Date(T0).toISOString();
    await env.DB.prepare(
      "INSERT INTO cl_bundles (id, number, computer_hash, router_hash, min_app, manifest_json, note, published_by, created_at) VALUES ('01ARZ3NDEKTSV4RRFFQ69G0001', 1, ?, ?, '0.0.0', '{}', '', 'a@b.c', ?)",
    )
      .bind('a'.repeat(64), 'b'.repeat(64), now)
      .run();
    await env.DB.prepare(
      "INSERT INTO cl_bundle_files (bundle_id, path, role, sha256, size) VALUES ('01ARZ3NDEKTSV4RRFFQ69G0001', 'os/x.npk', 'router', ?, 4)",
    )
      .bind(sha)
      .run();
    later(BLOB_ORPHAN_GRACE_MS + DAY);
    expect(await sweepOrphanBlobs(env)).toEqual({ blobs: 0, driveFiles: 0 });
    expect(await blobRow(sha)).not.toBeNull();
  });
});

describe('sweepOrphanBlobs: berkas yatim di Drive', () => {
  test('kembaran/sisa tanpa baris disapu bila cukup tua; yang ditunjuk baris, yang muda, tanpa umur, atau bernama lain tetap', async () => {
    const sha = await sha256Hex(bytesOf(50));
    await storeBlob(env, { sha256: sha, bytes: bytesOf(50) });
    const kept = (await blobRow(sha))?.driveFileId ?? '';
    const folder = await ensureBlobFolder(env);
    const old = new Date(T0 - 30 * DAY).toISOString();
    const add = async (name: string, createdTime?: string) => {
      const { id } = await env.BRIDGE.uploadFile(
        folder,
        name,
        'application/octet-stream',
        bytesOf(50),
      );
      const file = driveFile(id);
      if (file && createdTime !== undefined) file.createdTime = createdTime;
      return id;
    };
    const twin = await add(sha, old); // kembaran blob yang sama, bukan yang ditunjuk baris
    const stray = await add('f'.repeat(64), old); // tanpa baris sama sekali
    const young = await add('e'.repeat(64), new Date(T0).toISOString());
    const unknownAge = await add('d'.repeat(64));
    const otherName = await add('catatan.txt', old);
    const keptFile = driveFile(kept);
    if (keptFile) keptFile.createdTime = old; // yang ditunjuk baris, walau tua
    later(DAY); // baris kept berumur 1 hari: tahap 1 tak menyentuhnya
    const result = await sweepOrphanBlobs(env);
    expect(result).toEqual({ blobs: 0, driveFiles: 2 });
    expect(driveFile(twin)).toBeUndefined();
    expect(driveFile(stray)).toBeUndefined();
    for (const id of [kept, young, unknownAge, otherName]) expect(driveFile(id)).toBeDefined();
    expect((await blobRow(sha))?.driveFileId).toBe(kept);
  });
});

describe('storeBlob hanya memakai ulang berkas Drive yang muda (m1)', () => {
  test('berkas sehat tua (atau tanpa createdTime) tidak dipakai ulang: berkas baru diunggah, yang lama dibiarkan untuk penyapu', async () => {
    const bytes = bytesOf(70);
    const sha = await sha256Hex(bytes);
    const folder = await ensureBlobFolder(env);
    const put = async () =>
      (await env.BRIDGE.uploadFile(folder, sha, 'application/octet-stream', bytes)).id;
    const old = await put();
    const oldFile = driveFile(old);
    if (oldFile) oldFile.createdTime = new Date(T0 - 6.5 * DAY).toISOString();
    const unknownAge = await put();
    const before = env.BRIDGE.calls.filter((call) => call.action === 'uploadFile').length;
    await storeBlob(env, { sha256: sha, bytes });
    expect(env.BRIDGE.calls.filter((call) => call.action === 'uploadFile')).toHaveLength(
      before + 1,
    );
    const row = await blobRow(sha);
    expect([old, unknownAge]).not.toContain(row?.driveFileId ?? '');
    expect(driveFile(old)).toBeDefined();
    expect(driveFile(unknownAge)).toBeDefined();
    expect(driveFile(row?.driveFileId ?? '')).toBeDefined();
  });

  test('berkas sehat muda dipakai ulang tanpa unggah', async () => {
    const bytes = bytesOf(80);
    const sha = await sha256Hex(bytes);
    const folder = await ensureBlobFolder(env);
    const id = (await env.BRIDGE.uploadFile(folder, sha, 'application/octet-stream', bytes)).id;
    const file = driveFile(id);
    if (file) file.createdTime = new Date(T0 - 2 * DAY).toISOString();
    const before = env.BRIDGE.calls.filter((call) => call.action === 'uploadFile').length;
    await storeBlob(env, { sha256: sha, bytes });
    expect(env.BRIDGE.calls.filter((call) => call.action === 'uploadFile')).toHaveLength(before);
    expect((await blobRow(sha))?.driveFileId).toBe(id);
  });
});

describe('sweepOrphanBlobs: paginasi folder (m3)', () => {
  test('lebih dari 1.000 berkas yatim tua di folder semuanya disapu dalam satu putaran', async () => {
    const folder = await ensureBlobFolder(env);
    const old = new Date(T0 - 30 * DAY).toISOString();
    const total = 1100;
    for (let index = 0; index < total; index++) {
      env.BRIDGE.state.files.set(`orphan-${index}`, {
        folderId: folder,
        name: index.toString(16).padStart(64, '0'),
        mime: 'application/octet-stream',
        base64: 'AQID',
        shared: false,
        trashed: false,
        createdTime: old,
      });
    }
    const result = await sweepOrphanBlobs(env);
    expect(result.driveFiles).toBe(total);
    expect([...env.BRIDGE.state.files.keys()].filter((id) => id.startsWith('orphan-'))).toEqual([]);
  });
});

describe('storeBlob dan berkas kembar (review akhir M4)', () => {
  test('hanya berkas cacat yang dibuang; kembaran sehat (yang mungkin sudah dirujuk unggahan serentak) tetap ada', async () => {
    const bytes = bytesOf(60);
    const sha = await sha256Hex(bytes);
    const folder = await ensureBlobFolder(env);
    const put = async (data: Uint8Array) =>
      (await env.BRIDGE.uploadFile(folder, sha, 'application/octet-stream', data)).id;
    const healthyA = await put(bytes);
    const healthyB = await put(bytes);
    const corrupt = await put(bytesOf(90));
    const young = new Date(T0 - DAY).toISOString();
    for (const id of [healthyA, healthyB]) {
      const file = driveFile(id);
      if (file) file.createdTime = young;
    }
    await storeBlob(env, { sha256: sha, bytes });
    expect(driveFile(healthyA)).toBeDefined();
    expect(driveFile(healthyB)).toBeDefined();
    expect(driveFile(corrupt)).toBeUndefined();
    const row = await blobRow(sha);
    expect([healthyA, healthyB]).toContain(row?.driveFileId ?? '');
    expect(env.BRIDGE.calls.filter((call) => call.action === 'uploadFile')).toHaveLength(3);
  });
});
