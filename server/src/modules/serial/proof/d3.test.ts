import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { startScheduler } from '@server/jobs/runner';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SERIAL_PROOF_LIMITS } from '@shared/serials';
import { encodePngRgba } from './png';
import {
  claimDraftStmts,
  findProof,
  insertDraftStmt,
  setProofState,
  sumDraftBytesOf,
} from './repo';
import { newStagedName } from './store';
import { sweepExpiredFailedProofs } from './sweep';

// Keputusan pemilik 2026-11-16: retensi foto failed 14 hari dan kuota byte draft per pengguna 300 MB.

setDefaultTimeout(90_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer;
const OTHER = SERIAL_USERS.both;
const NOW = '2026-11-20T03:00:00.000Z';
const DAY = 86_400_000;
const realError = console.error;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse(NOW));
  await seedSerialWorld(env);
  await seedSerial(env, { id: 'sn-a', serial: 'AAA1', buId: 'bu-a' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

async function gradientPng(width = 64, height = 48): Promise<Uint8Array> {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (i % width) * 3;
    rgba[i * 4 + 1] = Math.floor(i / width) * 4;
    rgba[i * 4 + 2] = 120;
    rgba[i * 4 + 3] = 255;
  }
  return encodePngRgba({ width, height, rgba });
}

/** Foto `draft` dengan ukuran tercatat `size` (berkas kecil di disk; kuota dihitung dari kolom). */
async function seedDraft(
  id: string,
  options: { owner?: string; size?: number; bytes?: Uint8Array } = {},
): Promise<string> {
  const bytes = options.bytes ?? new Uint8Array([1, 2, 3]);
  const stagedName = newStagedName();
  await env.PROOF_STORE?.write(stagedName, bytes);
  await insertDraftStmt(env.DB, {
    id,
    createdBy: options.owner ?? W,
    now: NOW,
    mime: 'image/png',
    width: 640,
    height: 480,
    size: options.size ?? bytes.length,
    stagedName,
  }).run();
  return stagedName;
}

const claim = (id: string, serialId = 'sn-a') =>
  claimDraftStmts(env.DB, {
    ids: [id],
    email: W,
    serialId,
    eventId: `ev-${id}`,
    snapshotJson: '{}',
    now: NOW,
  });

/** Foto berstatus `state` yang `updated_at`-nya `ageDays` hari sebelum NOW. */
async function photoAged(
  id: string,
  state: 'draft' | 'queued' | 'processing' | 'failed' | 'done',
  ageDays: number,
): Promise<string> {
  const staged = await seedDraft(id);
  if (state !== 'draft') {
    await env.DB.batch(claim(id));
    if (state !== 'queued') {
      await setProofState(env.DB, id, { state, now: NOW, lastError: 'Berkas rusak' }).run();
    }
  }
  const at = new Date(Date.parse(NOW) - ageDays * DAY).toISOString();
  await env.DB.prepare('UPDATE serial_proof_photos SET updated_at = ? WHERE id = ?')
    .bind(at, id)
    .run();
  return staged;
}

describe('retensi foto failed', () => {
  const days = SERIAL_PROOF_LIMITS.failedRetentionDays;

  test('konstanta = 14 hari', () => {
    expect(days).toBe(14);
  });

  test('failed < 14 hari tetap; >= 14 hari dibuang beserta berkas, dengan audit sistem', async () => {
    const young = await photoAged('f-young', 'failed', days - 1);
    const edge = await photoAged('f-edge', 'failed', days);
    const old = await photoAged('f-old', 'failed', days + 10);
    expect(await sweepExpiredFailedProofs(env)).toBe(2);
    expect(await findProof(env.DB, 'f-young')).not.toBeNull();
    expect(await findProof(env.DB, 'f-edge')).toBeNull();
    expect(await findProof(env.DB, 'f-old')).toBeNull();
    expect(await env.PROOF_STORE?.stat(young)).not.toBeNull();
    expect(await env.PROOF_STORE?.stat(edge)).toBeNull();
    expect(await env.PROOF_STORE?.stat(old)).toBeNull();
    const audit = await rows(
      "SELECT actor, action, target, `before`, `after` FROM audit_log WHERE action = 'serial.proof_retention' ORDER BY id",
    );
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actor: 'system', target: 'serial:sn-a' });
    expect(JSON.parse(audit[0].before)).toMatchObject({ state: 'failed', error: 'Berkas rusak' });
    expect(JSON.parse(audit[0].after)).toEqual({ reason: 'retensi 14 hari' });
    // dijalankan lagi: tidak ada yang tersisa untuk dibuang
    expect(await sweepExpiredFailedProofs(env)).toBe(0);
  });

  test('draft, queued, processing, dan done tak tersentuh walau sangat tua', async () => {
    for (const state of ['draft', 'queued', 'processing', 'done'] as const) {
      await photoAged(`k-${state}`, state, 90);
    }
    expect(await sweepExpiredFailedProofs(env)).toBe(0);
    for (const state of ['draft', 'queued', 'processing', 'done']) {
      expect([state, (await findProof(env.DB, `k-${state}`)) !== null]).toEqual([state, true]);
    }
    expect(await rows("SELECT id FROM audit_log WHERE action = 'serial.proof_retention'")).toEqual(
      [],
    );
  });

  test('foto yang keburu dicoba ulang (queued) tidak terhapus: penghapusan bersyarat', async () => {
    const staged = await photoAged('f-race', 'failed', days + 1);
    // dicoba ulang sesudah dipilih sapuan: status kembali queued dengan updated_at baru
    await setProofState(env.DB, 'f-race', { state: 'queued', now: NOW }).run();
    expect(await sweepExpiredFailedProofs(env)).toBe(0);
    expect((await findProof(env.DB, 'f-race'))?.state).toBe('queued');
    expect(await env.PROOF_STORE?.stat(staged)).not.toBeNull();
  });

  test('riwayat dan badge tak rusak: serial tetap terbaca, foto yang dibuang hilang dari kejadian', async () => {
    const id = await call(W, 'serialProofs.upload', {
      mime: 'image/png',
      bytes: await gradientPng(),
      width: 64,
      height: 48,
    });
    const photoId = id.data.id as string;
    const saved = await call(W, 'serials.saveBatch', {
      rows: [
        {
          clientId: 'client-000001',
          serial: 'SN-RET',
          itemId: 'i-a1',
          buId: 'bu-a',
          testDate: '2026-11-20',
          locationId: 'loc-sby',
          sample: false,
          note: '',
          proofPhotoIds: [photoId],
        },
      ],
    });
    const serialId = saved.data.results[0].id as string;
    await setProofState(env.DB, photoId, { state: 'failed', now: NOW, lastError: 'rusak' }).run();
    await env.DB.prepare('UPDATE serial_proof_photos SET updated_at = ? WHERE id = ?')
      .bind(new Date(Date.parse(NOW) - 15 * DAY).toISOString(), photoId)
      .run();
    const before = await call(W, 'serials.get', { id: serialId });
    expect(before.data.serial.hasProofPhotos).toBe(true);
    expect(await sweepExpiredFailedProofs(env)).toBe(1);
    const after = await call(W, 'serials.get', { id: serialId });
    expect(after.ok).toBe(true);
    expect(after.data.serial.hasProofPhotos).toBe(false);
    const recorded = after.data.events.find((e: Json) => e.type === 'recorded');
    expect(recorded.proofPhotos).toEqual([]);
    const history = await call(W, 'serials.history', { id: serialId });
    expect(history.ok).toBe(true);
    expect((await call(W, 'serialProofs.get', { id: photoId })).ok).toBe(false);
  });

  test('penjadwal jam-an ikut menjalankan retensi', async () => {
    await photoAged('f-sched', 'failed', days + 5);
    const stop = startScheduler(env, { intervalMs: 3_600_000 });
    try {
      const start = Date.now();
      while ((await findProof(env.DB, 'f-sched')) !== null) {
        if (Date.now() - start > 15_000) throw new Error('penjadwal tidak menjalankan retensi');
        await Bun.sleep(20);
      }
    } finally {
      await stop();
    }
  });
});

describe('kuota byte draft per pengguna', () => {
  const limit = SERIAL_PROOF_LIMITS.draftBytesPerUser;
  const message =
    'Kuota foto sementara kamu penuh (maks 300 MB). Simpan atau buang foto yang belum terpakai.';

  async function uploadPng(email: string = W): Promise<CallOut> {
    return call(email, 'serialProofs.upload', {
      mime: 'image/png',
      bytes: await gradientPng(),
      width: 64,
      height: 48,
    });
  }

  test('konstanta = 300 MB', () => {
    expect(limit).toBe(300 * 1024 * 1024);
  });

  test('unggahan yang melewati 300 MB ditolak dengan pesan jelas; setelah Buang kuota kembali', async () => {
    const png = await gradientPng();
    await seedDraft('big', { size: limit - png.length + 1 }); // sisa 1 byte kurang dari ukuran unggahan
    expect(await sumDraftBytesOf(env.DB, W)).toBe(limit - png.length + 1);
    const rejected = await uploadPng();
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe('CONFLICT');
    expect(rejected.error?.message).toBe(message);
    expect(await rows('SELECT id FROM serial_proof_photos')).toHaveLength(1);
    // pengguna lain tak terpengaruh (kuota per pengguna)
    expect((await uploadPng(OTHER)).ok).toBe(true);
    // Buang foto besar: kuota kembali
    expect((await call(W, 'serialProofs.remove', { id: 'big' })).ok).toBe(true);
    expect((await uploadPng()).ok).toBe(true);
  });

  test('tepat di batas diterima', async () => {
    const png = await gradientPng();
    await seedDraft('edge', { size: limit - png.length });
    expect((await uploadPng()).ok).toBe(true);
  });

  test('setelah Simpan (foto tak lagi draft) kuota kembali', async () => {
    const png = await gradientPng();
    await seedDraft('big', { size: limit - png.length + 1 });
    expect((await uploadPng()).ok).toBe(false);
    await env.DB.batch(claim('big')); // diklaim Simpan: queued
    expect(await sumDraftBytesOf(env.DB, W)).toBe(0);
    expect((await uploadPng()).ok).toBe(true);
  });

  test('dua unggahan serentak yang bersama-sama melewati batas: total draft tak pernah melebihi batas', async () => {
    const png = await gradientPng();
    await seedDraft('big', { size: limit - Math.floor(png.length * 1.5) });
    const [a, b] = await Promise.all([uploadPng(), uploadPng()]);
    expect([a.ok, b.ok].filter(Boolean).length).toBeLessThanOrEqual(1);
    expect(await sumDraftBytesOf(env.DB, W)).toBeLessThanOrEqual(limit);
    const failed = [a, b].filter((r) => !r.ok);
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0]?.error?.message).toBe(message);
    // berkas milik unggahan yang ditolak tak tertinggal di disk
    const files = (await env.PROOF_STORE?.list()) ?? [];
    const rowsNow = await rows('SELECT staged_name FROM serial_proof_photos');
    expect(files.length).toBe(rowsNow.length);
  });

  test('batas 10 MB per berkas tetap berlaku (tidak berubah)', async () => {
    const out = await call(W, 'serialProofs.upload', {
      mime: 'image/png',
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      width: 64,
      height: 48,
    });
    expect(out.ok).toBe(false);
  });
});
