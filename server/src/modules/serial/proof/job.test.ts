import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { runPendingJobs } from '@server/jobs/runner';
import { JOB_MAX_ATTEMPTS } from '@server/modules/jobs/consumer';
import { findJob } from '@server/modules/jobs/repo';
import { restCall } from '@server-test/rest-call';
import { restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { serialProofJobStmt } from './job';
import { encodePngRgba } from './png';
import { claimDraftStmts, findProof, insertDraftStmt } from './repo';
import { stampFooterHeight } from './stamp';
import { newStagedName } from './store';

// Job `serial_proof`: cap, unggah ke Drive, dan penyelesaian (tiga langkah idempoten), lewat runner nyata dan klien
// Google palsu (`env.BRIDGE`).

setDefaultTimeout(90_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const W = SERIAL_USERS.writer;
const VIEWER = SERIAL_USERS.viewer;
const SAVED_AT = '2026-11-20T03:00:00.000Z';
const SNAPSHOT = {
  serial: 'AAA1',
  brand: 'Merk',
  model: 'Alfa',
  buCode: 'A',
  locationName: 'Surabaya',
  actorName: 'Pencatat',
  actorTeam: 'qc',
  savedAt: SAVED_AT,
};
const realError = console.error;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse(SAVED_AT));
  rest = restClient(env);
  await seedSerialWorld(env);
  await seedSerial(env, { id: 'sn-a', serial: 'AAA1', buId: 'bu-a' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

/** PNG nyata (gradien) berukuran `width` x `height`. */
async function realPng(width = 64, height = 48): Promise<Uint8Array> {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (i % width) * 3;
    rgba[i * 4 + 1] = Math.floor(i / width) * 4;
    rgba[i * 4 + 2] = 120;
    rgba[i * 4 + 3] = 255;
  }
  return encodePngRgba({ width, height, rgba });
}

async function upload(bytes: Uint8Array, width = 64, height = 48): Promise<string> {
  const out = await call(W, 'serialProofs.upload', { mime: 'image/png', bytes, width, height });
  expect(out.ok).toBe(true);
  return out.data.id as string;
}

/** Klaim draft ke kejadian dan pasang job seperti yang dilakukan Simpan (satu batch). */
async function queue(id: string): Promise<string> {
  await env.DB.batch([
    ...claimDraftStmts(env.DB, {
      ids: [id],
      email: W,
      serialId: 'sn-a',
      eventId: `ev-${id}`,
      snapshotJson: JSON.stringify(SNAPSHOT),
      now: SAVED_AT,
    }),
    serialProofJobStmt(env, id),
  ]);
  return jobIdOf(id);
}

async function jobIdOf(photoId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM jobs WHERE kind = 'serial_proof' AND input = ?")
    .bind(JSON.stringify({ photoId }))
    .first<{ id: string }>();
  return (row as { id: string }).id;
}

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

const driveProofFiles = () =>
  [...env.BRIDGE.state.files.values()].filter((file) => file.name.startsWith('proof-'));

/** Menjalankan job sampai selesai/gagal; tiap galat sementara menunggu lease habis (jam terkendali). */
async function drain(): Promise<void> {
  for (let round = 0; round < JOB_MAX_ATTEMPTS + 2; round++) {
    await runPendingJobs(env);
    env.clock.advance(5 * 60_000);
  }
}

describe('jalur sukses', () => {
  test('foto menjadi done: baris files serialproof, berkas sementara terhapus, unduhan bercap lebih tinggi', async () => {
    const id = await upload(await realPng());
    const jobId = await queue(id);
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, jobId))?.status).toBe('done');
    const proof = await findProof(env.DB, id);
    expect(proof?.state).toBe('done');
    expect(proof?.fileId).not.toBe('');
    expect(proof?.lastError).toBe('');
    const footer = stampFooterHeight(64);
    expect(proof).toMatchObject({ mime: 'image/webp', width: 64, height: 48 + footer });
    // baris files: pemilik serialproof = id serial, dibuat oleh pengunggah foto
    const files = await rows('SELECT * FROM files WHERE id = ?', proof?.fileId);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      owner_type: 'serialproof',
      owner_id: 'sn-a',
      created_by: W,
      mime: 'image/webp',
      status: 'active',
    });
    // tepat satu berkas Drive bernama proof-<id>.webp; tak ada sisa di disk
    expect(driveProofFiles().map((file) => file.name)).toEqual([`proof-${id}.webp`]);
    expect(await env.PROOF_STORE?.totalBytes()).toBe(0);
    // unduhan lewat serialProofs.get (pembaca BU A) melayani webp bercap
    const response = await rest.get(`/serial-proofs/${id}`, { email: VIEWER });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    const meta = await new Bun.Image(new Uint8Array(await response.arrayBuffer())).metadata();
    expect(meta.height).toBeGreaterThan(48);
    expect(meta.height).toBe(48 + footer);
    // job yang sama tak dijalankan ulang
    expect(await runPendingJobs(env)).toBe(0);
  });

  test('tersambung ujung ke ujung: Simpan (saveBatch) memasang job, runner menyelesaikannya, riwayat menampilkan done', async () => {
    const id = await upload(await realPng());
    const out = await call(W, 'serials.saveBatch', {
      rows: [
        {
          clientId: 'client-000001',
          serial: 'SN-E2E',
          itemId: 'i-a1',
          buId: 'bu-a',
          testDate: '2026-11-20',
          locationId: 'loc-sby',
          sample: false,
          note: '',
          proofPhotoIds: [id],
        },
      ],
    });
    expect(out.ok).toBe(true);
    expect(out.data.results[0].result).toBe('created');
    expect((await findProof(env.DB, id))?.state).toBe('queued');
    expect(await runPendingJobs(env)).toBe(1);
    const proof = await findProof(env.DB, id);
    expect(proof?.state).toBe('done');
    const serial = (await rows("SELECT id FROM serials WHERE serial = 'SN-E2E'"))[0] as Json;
    expect(proof?.serialId).toBe(serial.id);
    // cap memuat data beku saat Simpan (nomor serial dari kejadian, bukan dari serial lain)
    const snapshot = JSON.parse(proof?.snapshotJson ?? '{}');
    expect(snapshot).toMatchObject({ serial: 'SN-E2E', savedAt: SAVED_AT });
  });
});

describe('langkah unggah diulang', () => {
  test('unggahan sampai ke Drive tetapi jawabannya hilang: pengulangan memakai berkas yang ada, tanpa berkas ganda', async () => {
    const id = await upload(await realPng());
    const jobId = await queue(id);
    const original = env.BRIDGE.uploadFile.bind(env.BRIDGE);
    let calls = 0;
    env.BRIDGE.uploadFile = async (...args) => {
      calls++;
      const result = await original(...args);
      if (calls === 1) throw new Error('koneksi putus setelah unggah');
      return result;
    };
    expect(await runPendingJobs(env)).toBe(1);
    // percobaan 1 gagal sementara: belum failed, satu berkas sudah ada di Drive
    expect((await findJob(env, jobId))?.status).toBe('running');
    expect(driveProofFiles()).toHaveLength(1);
    env.clock.advance(5 * 60_000);
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, jobId))?.status).toBe('done');
    expect(calls).toBe(1); // pengulangan memeriksa Drive, tidak mengunggah lagi
    expect(driveProofFiles()).toHaveLength(1);
    const proof = await findProof(env.DB, id);
    expect(proof?.state).toBe('done');
    const file = (await rows('SELECT drive_id FROM files WHERE id = ?', proof?.fileId))[0] as Json;
    expect([...env.BRIDGE.state.files.keys()]).toContain(file.drive_id);
  });

  test('langkah selesai diulang (komit sudah terjadi): foto done tidak diproses lagi dan tak ada baris files ganda', async () => {
    const id = await upload(await realPng());
    const jobId = await queue(id);
    expect(await runPendingJobs(env)).toBe(1);
    // job dihidupkan lagi seolah penyelesaian langkah gagal tercatat: handler harus melewatinya
    await env.DB.prepare(
      "UPDATE jobs SET status = 'running', step = 2, lease_until = 0 WHERE id = ?",
    )
      .bind(jobId)
      .run();
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, jobId))?.status).toBe('done');
    expect(await rows("SELECT id FROM files WHERE owner_type = 'serialproof'")).toHaveLength(1);
    expect(driveProofFiles()).toHaveLength(1);
  });
});

describe('Drive mati', () => {
  test('diulang lalu failed setelah percobaan habis; retry memprosesnya sampai done tanpa berkas ganda', async () => {
    const id = await upload(await realPng());
    const jobId = await queue(id);
    env.BRIDGE.uploadFile = async () => {
      throw new Error('Drive mati (rahasia: /var/lib/qc/proofs)');
    };
    await runPendingJobs(env);
    expect((await findJob(env, jobId))?.status).toBe('running');
    expect((await findProof(env.DB, id))?.state).toBe('processing');
    await drain();
    expect((await findJob(env, jobId))?.status).toBe('failed');
    const failed = await findProof(env.DB, id);
    expect(failed?.state).toBe('failed');
    expect(failed?.lastError).not.toBe('');
    // alasan ringkas: tanpa jalur server dan tanpa pesan mentah galat
    expect(failed?.lastError).not.toContain('/var/lib');
    expect(failed?.lastError).not.toContain('rahasia');
    // berkas asli dipertahankan untuk retry; hasil bercap dibuang
    const stored = await env.PROOF_STORE?.read(failed?.stagedName as string);
    expect(stored).not.toBeNull();
    expect(driveProofFiles()).toHaveLength(0);
  });

  test('setelah Drive pulih, serialProofs.retry memproses ulang sampai done', async () => {
    const id = await upload(await realPng());
    await queue(id);
    const original = env.BRIDGE.uploadFile.bind(env.BRIDGE);
    env.BRIDGE.uploadFile = async () => {
      throw new Error('Drive mati');
    };
    await drain();
    expect((await findProof(env.DB, id))?.state).toBe('failed');
    env.BRIDGE.uploadFile = original;
    const retried = await call(W, 'serialProofs.retry', { id });
    expect(retried.ok).toBe(true);
    expect(retried.data.state).toBe('queued');
    await drain();
    const proof = await findProof(env.DB, id);
    expect(proof?.state).toBe('done');
    expect(proof?.lastError).toBe('');
    expect(driveProofFiles().map((file) => file.name)).toEqual([`proof-${id}.webp`]);
    expect(await env.PROOF_STORE?.totalBytes()).toBe(0);
    expect(await rows("SELECT id FROM files WHERE owner_type = 'serialproof'")).toHaveLength(1);
  });
});

describe('gambar tak dapat diproses', () => {
  /** Draft dengan isi berkas apa pun (melewati validasi unggah) agar job yang menemukannya. */
  async function seedRaw(id: string, bytes: Uint8Array): Promise<void> {
    const stagedName = newStagedName();
    await env.PROOF_STORE?.write(stagedName, bytes);
    await insertDraftStmt(env.DB, {
      id,
      createdBy: W,
      now: SAVED_AT,
      mime: 'image/png',
      width: 64,
      height: 48,
      size: bytes.length,
      stagedName,
    }).run();
  }

  const header = (width: number, height: number): number[] => {
    const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    const tag = [...'IHDR'].map((c) => c.charCodeAt(0));
    return [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...be32(13),
      ...tag,
      ...be32(width),
      ...be32(height),
      8,
      6,
      0,
      0,
      0,
    ];
  };

  test('berkas rusak: foto failed dengan alasan, job failed (bukan macet), berkas asli tetap ada', async () => {
    const bytes = new Uint8Array([...header(64, 48), ...new Array(200).fill(7)]);
    await seedRaw('p-bad', bytes);
    const jobId = await queue('p-bad');
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, jobId))?.status).toBe('failed');
    const proof = await findProof(env.DB, 'p-bad');
    expect(proof?.state).toBe('failed');
    expect(proof?.lastError).not.toBe('');
    expect(await env.PROOF_STORE?.read(proof?.stagedName as string)).not.toBeNull();
    // tidak diulang oleh runner (galat permanen)
    expect(await runPendingJobs(env)).toBe(0);
    const dto = await call(W, 'serialProofs.get', { id: 'p-bad' });
    expect(dto.ok).toBe(true);
  });

  test('piksel ekstrem (header 10000 x 10000): ditolak sebelum decode, foto failed', async () => {
    const bytes = new Uint8Array([...header(10_000, 10_000), ...new Array(64).fill(1)]);
    await seedRaw('p-big', bytes);
    const jobId = await queue('p-big');
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, jobId))?.status).toBe('failed');
    const proof = await findProof(env.DB, 'p-big');
    expect(proof?.state).toBe('failed');
    expect(proof?.lastError).not.toBe('');
    expect(driveProofFiles()).toHaveLength(0);
  });

  test('berkas sementara hilang: failed dengan alasan jelas', async () => {
    const id = await upload(await realPng());
    const proof = await findProof(env.DB, id);
    await env.PROOF_STORE?.remove(proof?.stagedName as string);
    const jobId = await queue(id);
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, jobId))?.status).toBe('failed');
    const failed = await findProof(env.DB, id);
    expect(failed?.state).toBe('failed');
    expect(failed?.lastError).toContain('sudah tidak ada');
  });
});

describe('foto bukti dan pustaka stiker', () => {
  test('foto selesai tidak muncul di stickerGuides.list dan sticker_guide_images tidak bertambah', async () => {
    const before = await call('admin@gmail.com', 'stickerGuides.list', {});
    const id = await upload(await realPng());
    await queue(id);
    await runPendingJobs(env);
    const proof = await findProof(env.DB, id);
    expect(proof?.state).toBe('done');
    const after = await call('admin@gmail.com', 'stickerGuides.list', {});
    expect(after.ok).toBe(true);
    expect(after.data.items).toEqual(before.data.items);
    expect(JSON.stringify(after.data)).not.toContain(proof?.fileId as string);
    expect(
      await rows('SELECT id FROM sticker_guide_images WHERE id = ?', proof?.fileId),
    ).toHaveLength(0);
  });
});
