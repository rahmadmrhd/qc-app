import { beforeEach, describe, expect, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { CL_BINARY_MAX_BYTES, CL_CHUNK_BYTES, CL_FILES_MAX } from '@shared/countrylock-bundle';
import { openBlob } from './blob-store';
import { clFileHistory, listClFiles } from './files-service';
import { sha256Hex } from './hash';
import { sweepCountryLockUploads } from './sweep';
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
const OTHER = { email: 'lain@gmail.com' };

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-28T00:00:00.000Z'));
});

type Failure = { code?: string; message: string };

async function errorOf(promise: Promise<unknown>): Promise<Failure> {
  return promise.then(
    () => {
      throw new Error('seharusnya gagal');
    },
    (error: Failure) => error,
  );
}

const DATA = Uint8Array.from({ length: 10 }, (_, index) => index * 3 + 1);

async function start(path: string, bytes: Uint8Array, actor = OWNER, chunkBytes = 4) {
  const input = validateStartClUpload({
    path,
    role: 'router',
    size: bytes.length,
    sha256: await sha256Hex(bytes),
  });
  return startClUpload(env, input, actor, { chunkBytes });
}

const chunk = (id: string, idx: number, bytes: Uint8Array, actor = OWNER) =>
  putClUploadChunk(env, validateChunkClUpload({ id, idx: String(idx), bytes }), actor);

const finish = (id: string, actor = OWNER) =>
  finishClUpload(env, validateFinishClUpload({ id }), actor);

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const driveUploads = () => env.BRIDGE.calls.filter((call) => call.action === 'uploadFile');

describe('unggah biner bertahap', () => {
  test('3 potongan lalu finish: berkas biner headRev 1 dan openBlob mengembalikan byte yang sama', async () => {
    const session = await start('mikrotik/system.npk', DATA);
    expect(session.chunkBytes).toBe(4);
    expect(await chunk(session.uploadId, 0, DATA.slice(0, 4))).toEqual({ received: 1 });
    expect(await chunk(session.uploadId, 1, DATA.slice(4, 8))).toEqual({ received: 2 });
    expect(await chunk(session.uploadId, 2, DATA.slice(8))).toEqual({ received: 3 });
    const file = await finish(session.uploadId);
    expect(file).toMatchObject({
      path: 'mikrotik/system.npk',
      role: 'router',
      kind: 'binary',
      headRev: 1,
      size: 10,
      sha256: await sha256Hex(DATA),
    });
    const blob = await openBlob(env, file.sha256);
    expect(blob.size).toBe(10);
    expect(await readAll(blob.stream)).toEqual(DATA);
    expect(driveUploads()).toHaveLength(1);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM cl_upload_chunks').first<{
      n: number;
    }>();
    expect(Number(left?.n)).toBe(0);
    const audit = await env.DB.prepare('SELECT action FROM audit_log').all<{ action: string }>();
    expect(audit.results.map((row) => row.action)).toEqual(['countrylock.file_save']);
  });

  test('potongan di luar urutan = CONFLICT; idx ganda sama isi idempoten, beda isi CONFLICT', async () => {
    const session = await start('a.bin', DATA);
    expect((await errorOf(chunk(session.uploadId, 1, DATA.slice(4, 8)))).code).toBe('CONFLICT');
    expect((await errorOf(chunk(session.uploadId, 2, DATA.slice(8)))).code).toBe('CONFLICT');
    await chunk(session.uploadId, 0, DATA.slice(0, 4));
    expect(await chunk(session.uploadId, 0, DATA.slice(0, 4))).toEqual({ received: 1 });
    expect((await errorOf(chunk(session.uploadId, 0, Uint8Array.from([9, 9, 9, 9])))).code).toBe(
      'CONFLICT',
    );
    expect((await errorOf(chunk(session.uploadId, 3, DATA.slice(8)))).code).toBe('VALIDATION');
  });

  test('finish tanpa semua potongan atau ukuran/sha256 salah = VALIDATION dan sesi tetap bisa dilanjutkan', async () => {
    const session = await start('b.bin', DATA);
    await chunk(session.uploadId, 0, DATA.slice(0, 4));
    expect((await errorOf(finish(session.uploadId))).code).toBe('VALIDATION'); // potongan belum lengkap
    await chunk(session.uploadId, 1, DATA.slice(4, 8));
    // potongan terakhir salah isi (ukuran sama, sha256 lain)
    await chunk(session.uploadId, 2, Uint8Array.from([0, 0]));
    const bad = await errorOf(finish(session.uploadId));
    expect(bad.code).toBe('VALIDATION');
    expect(driveUploads()).toHaveLength(0);
    // sesi masih terbuka: potongan 2 yang salah tak dapat diganti (isi beda = CONFLICT), jadi sesi baru untuk unggah ulang
    expect((await errorOf(chunk(session.uploadId, 2, DATA.slice(8)))).code).toBe('CONFLICT');
    const again = await start('b.bin', DATA);
    for (const [idx, part] of [DATA.slice(0, 4), DATA.slice(4, 8), DATA.slice(8)].entries()) {
      await chunk(again.uploadId, idx, part);
    }
    expect((await finish(again.uploadId)).headRev).toBe(1);
  });

  test('sha256 hasil unggahan salah: finish ditolak, sesi tetap open tanpa berkas/unggahan Drive; pemulihan = sesi BARU yang benar', async () => {
    // Potongan tak dapat diganti isinya (CONFLICT), jadi finish ulang pada sesi yang sama mustahil; jalur pulihnya sesi
    // baru untuk path yang sama (sesi lama dibuang penyapu setelah 24 jam).
    const declared = await sha256Hex(Uint8Array.from([1, 2, 3, 4]));
    const session = await startClUpload(
      env,
      validateStartClUpload({ path: 'c.bin', role: 'router', size: 4, sha256: declared }),
      OWNER,
      { chunkBytes: 4 },
    );
    await chunk(session.uploadId, 0, Uint8Array.from([4, 3, 2, 1]));
    expect((await errorOf(finish(session.uploadId))).code).toBe('VALIDATION');
    expect(await listClFiles(env)).toEqual([]);
    expect(driveUploads()).toHaveLength(0);
    const row = await env.DB.prepare('SELECT state FROM cl_uploads WHERE id = ?')
      .bind(session.uploadId)
      .first<{ state: string }>();
    expect(row?.state).toBe('open');
    const retry = await startClUpload(
      env,
      validateStartClUpload({ path: 'c.bin', role: 'router', size: 4, sha256: declared }),
      OWNER,
      { chunkBytes: 4 },
    );
    await chunk(retry.uploadId, 0, Uint8Array.from([1, 2, 3, 4]));
    expect((await finish(retry.uploadId)).path).toBe('c.bin');
    expect(driveUploads()).toHaveLength(1);
  });

  test('unggah biner BARU saat draf penuh (CL_FILES_MAX) = VALIDATION di start dan di finish', async () => {
    const session = await start('lama.bin', DATA); // sesi dibuka SEBELUM draf penuh
    const count = CL_FILES_MAX;
    const now = '2026-11-28T00:00:00.000Z';
    const rows = Array.from({ length: count }, (_, index) => ({
      id: `01ARZ3NDEKTSV4RRFFQ69G${String(index).padStart(4, '0')}`,
      path: `isi/${index}.rsc`,
    }));
    await env.DB.prepare(
      `INSERT INTO cl_files (id, path, path_key, role, kind, head_rev, removed_at, created_at, updated_at) VALUES ${rows
        .map(() => "(?, ?, ?, 'script', 'text', 1, '', ?, ?)")
        .join(', ')}`,
    )
      .bind(...rows.flatMap((row) => [row.id, row.path, row.path.toLowerCase(), now, now]))
      .run();
    expect((await errorOf(start('baru.bin', DATA))).code).toBe('VALIDATION');
    for (const [idx, part] of [DATA.slice(0, 4), DATA.slice(4, 8), DATA.slice(8)].entries()) {
      await chunk(session.uploadId, idx, part);
    }
    expect((await errorOf(finish(session.uploadId))).code).toBe('VALIDATION');
    expect(driveUploads()).toHaveLength(0);
  });

  test('unggah ulang isi yang sama tidak mengunggah ke Drive lagi; isi sama dengan revisi terbaru = no-op', async () => {
    const first = await start('d.bin', DATA);
    for (const [idx, part] of [DATA.slice(0, 4), DATA.slice(4, 8), DATA.slice(8)].entries()) {
      await chunk(first.uploadId, idx, part);
    }
    await finish(first.uploadId);
    // berkas lain dengan isi sama: blob dipakai ulang
    const second = await start('e.bin', DATA);
    for (const [idx, part] of [DATA.slice(0, 4), DATA.slice(4, 8), DATA.slice(8)].entries()) {
      await chunk(second.uploadId, idx, part);
    }
    const copy = await finish(second.uploadId);
    expect(copy.headRev).toBe(1);
    expect(driveUploads()).toHaveLength(1);
    // path yang sama dengan isi yang sama: no-op (tanpa revisi baru)
    const third = await start('d.bin', DATA);
    for (const [idx, part] of [DATA.slice(0, 4), DATA.slice(4, 8), DATA.slice(8)].entries()) {
      await chunk(third.uploadId, idx, part);
    }
    const same = await finish(third.uploadId);
    expect(same.headRev).toBe(1);
    expect(driveUploads()).toHaveLength(1);
    expect(await clFileHistory(env, { id: same.id })).toHaveLength(1);
    // finish diulang pada sesi yang sudah selesai mengembalikan berkas yang sama
    expect((await finish(third.uploadId)).id).toBe(same.id);
  });

  test('isi baru pada path yang ada = revisi baru; isi yang sama menjadi dasar blob tunggal', async () => {
    const first = await start('f.bin', DATA);
    for (const [idx, part] of [DATA.slice(0, 4), DATA.slice(4, 8), DATA.slice(8)].entries()) {
      await chunk(first.uploadId, idx, part);
    }
    const created = await finish(first.uploadId);
    const next = Uint8Array.from([7, 7, 7, 7, 7]);
    const second = await start('f.bin', next);
    await chunk(second.uploadId, 0, next.slice(0, 4));
    await chunk(second.uploadId, 1, next.slice(4));
    const updated = await finish(second.uploadId);
    expect(updated.id).toBe(created.id);
    expect(updated.headRev).toBe(2);
    expect(updated.size).toBe(5);
    expect(driveUploads()).toHaveLength(2);
  });

  test('pemilik lain = NOT_FOUND pada chunk dan finish; sesi tak ada = NOT_FOUND', async () => {
    const session = await start('g.bin', DATA);
    expect((await errorOf(chunk(session.uploadId, 0, DATA.slice(0, 4), OTHER))).code).toBe(
      'NOT_FOUND',
    );
    expect((await errorOf(finish(session.uploadId, OTHER))).code).toBe('NOT_FOUND');
    expect((await errorOf(chunk('tidak-ada', 0, DATA.slice(0, 4)))).code).toBe('NOT_FOUND');
  });

  test('openBlob dengan range {start:1,end:2} mengembalikan 2 byte', async () => {
    const session = await start('h.bin', DATA);
    for (const [idx, part] of [DATA.slice(0, 4), DATA.slice(4, 8), DATA.slice(8)].entries()) {
      await chunk(session.uploadId, idx, part);
    }
    const file = await finish(session.uploadId);
    const partial = await openBlob(env, file.sha256, { start: 1, end: 2 });
    expect(partial.size).toBe(10);
    expect(partial.range).toEqual({ start: 1, end: 2 });
    expect(await readAll(partial.stream)).toEqual(DATA.slice(1, 3));
    const tail = await openBlob(env, file.sha256, { start: 8, end: 999 });
    expect(tail.range).toEqual({ start: 8, end: 9 });
    expect(await readAll(tail.stream)).toEqual(DATA.slice(8));
    expect((await errorOf(openBlob(env, file.sha256, { start: 10, end: 12 }))).code).toBe(
      'VALIDATION',
    );
    expect((await errorOf(openBlob(env, 'f'.repeat(64)))).code).toBe('NOT_FOUND');
  });

  test('validasi awal sesi: ukuran, peran, sha256, path', () => {
    const base = { path: 'x.bin', role: 'router', size: 5, sha256: 'a'.repeat(64) };
    expect(validateStartClUpload(base).size).toBe(5);
    for (const bad of [
      { ...base, size: 0 },
      { ...base, size: CL_BINARY_MAX_BYTES + 1 },
      { ...base, size: 1.5 },
      { ...base, role: 'script' },
      { ...base, role: 'settings' },
      { ...base, sha256: 'A'.repeat(64) },
      { ...base, sha256: 'a'.repeat(63) },
      { ...base, path: '../x' },
      { ...base, path: 'settings.json' },
    ]) {
      expect(() => validateStartClUpload(bad)).toThrow();
    }
    expect(CL_CHUNK_BYTES).toBe(4 * 1024 * 1024);
  });

  test('sesi memakai batas 4 MiB bawaan dan menolak potongan lebih besar dari batas', async () => {
    const session = await startClUpload(
      env,
      validateStartClUpload({
        path: 'big.bin',
        role: 'router',
        size: CL_CHUNK_BYTES + 5,
        sha256: 'a'.repeat(64),
      }),
      OWNER,
    );
    expect(session.chunkBytes).toBe(CL_CHUNK_BYTES);
    expect(() =>
      validateChunkClUpload({
        id: session.uploadId,
        idx: '0',
        bytes: new Uint8Array(CL_CHUNK_BYTES + 1),
      }),
    ).toThrow();
  });
});

describe('sweepCountryLockUploads', () => {
  test('membuang sesi open lebih dari 24 jam beserta potongannya; sesi baru tetap', async () => {
    const old = await start('old.bin', DATA);
    await chunk(old.uploadId, 0, DATA.slice(0, 4));
    env.clock.set(Date.parse('2026-11-29T00:00:01.000Z'));
    const fresh = await start('new.bin', DATA);
    await chunk(fresh.uploadId, 0, DATA.slice(0, 4));
    const result = await sweepCountryLockUploads(env);
    expect(result.removed).toBe(1);
    const sessions = await env.DB.prepare('SELECT id FROM cl_uploads').all<{ id: string }>();
    expect(sessions.results.map((row) => row.id)).toEqual([fresh.uploadId]);
    const chunks = await env.DB.prepare('SELECT upload_id FROM cl_upload_chunks').all<{
      upload_id: string;
    }>();
    expect(chunks.results.map((row) => row.upload_id)).toEqual([fresh.uploadId]);
    expect((await errorOf(chunk(old.uploadId, 1, DATA.slice(4, 8)))).code).toBe('NOT_FOUND');
  });
});
