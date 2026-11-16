import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPendingJobs } from '@server/jobs/runner';
import { findJob } from '@server/modules/jobs/repo';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { canManageProof } from './access';
import { serialProofJobStmt } from './job';
import { encodePngRgba } from './png';
import { claimDraftStmts, findProof, insertDraftStmt, setProofState, toProofDto } from './repo';
import {
  assertProofSize,
  PROOF_MAX_CANVAS_PIXELS,
  PROOF_MAX_SIDE,
  proofSizeError,
  stampFooterHeight,
  stampPhoto,
} from './stamp';
import { createProofStore, newStagedName } from './store';
import { ORPHAN_MIN_AGE_MS, sweepOrphanProofFiles } from './sweep';

// Putaran perbaikan D2: batas sisi dan luas kanvas, kegagalan ukuran tak dapat dicoba lagi, rujukan penyapu yatim,
// dan canManage yang menimbang izin edit saat ini.

setDefaultTimeout(90_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer;
const NOW = '2026-11-20T03:00:00.000Z';
const realError = console.error;
const SNAPSHOT = {
  serial: 'AAA1',
  brand: 'Merk',
  model: 'Alfa',
  buCode: 'A',
  locationName: 'Surabaya',
  actorName: 'Pencatat',
  actorTeam: 'qc',
  savedAt: NOW,
};

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

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

async function flatPng(width: number, height: number): Promise<Uint8Array> {
  return encodePngRgba({ width, height, rgba: new Uint8Array(width * height * 4) });
}

async function seedDraft(id: string, bytes: Uint8Array, width = 64, height = 48): Promise<string> {
  const stagedName = newStagedName();
  await env.PROOF_STORE?.write(stagedName, bytes);
  await insertDraftStmt(env.DB, {
    id,
    createdBy: W,
    now: NOW,
    mime: 'image/png',
    width,
    height,
    size: bytes.length,
    stagedName,
  }).run();
  return stagedName;
}

const claim = (id: string) =>
  claimDraftStmts(env.DB, {
    ids: [id],
    email: W,
    serialId: 'sn-a',
    eventId: `ev-${id}`,
    snapshotJson: JSON.stringify(SNAPSHOT),
    now: NOW,
  });

async function queue(id: string): Promise<string> {
  await env.DB.batch([...claim(id), serialProofJobStmt(env, id)]);
  const row = await env.DB.prepare("SELECT id FROM jobs WHERE kind = 'serial_proof' AND input = ?")
    .bind(JSON.stringify({ photoId: id }))
    .first<{ id: string }>();
  return (row as { id: string }).id;
}

const jobCount = async () =>
  (await env.DB.prepare("SELECT id FROM jobs WHERE kind = 'serial_proof'").all()).results.length;

describe('batas sisi dan luas kanvas', () => {
  test('ambang: tepat di batas diterima, satu piksel di atas ditolak', () => {
    expect(proofSizeError(2100, 2000)).toBeNull(); // tepat 4,2 juta piksel
    expect(proofSizeError(2101, 2000)).not.toBeNull(); // 4.202.000
    expect(proofSizeError(2048, 2048)).toBeNull();
    expect(proofSizeError(PROOF_MAX_SIDE, 100)).toBeNull();
    expect(proofSizeError(PROOF_MAX_SIDE + 1, 100)).not.toBeNull();
    expect(proofSizeError(100, PROOF_MAX_SIDE + 1)).not.toBeNull();
    // kanvas: lebar x (tinggi + footer) <= PROOF_MAX_CANVAS_PIXELS
    const w = PROOF_MAX_SIDE;
    const maxH = Math.floor(PROOF_MAX_CANVAS_PIXELS / w) - stampFooterHeight(w);
    expect(proofSizeError(w, maxH)).toBeNull();
    expect(proofSizeError(w, maxH + 1)).not.toBeNull();
    expect(proofSizeError(20_000, 200)).not.toBeNull(); // sangat lebar: footer menurut lebar
  });

  test('PNG 20000 x 200 ditolak saat unggah dan oleh stampPhoto tanpa menaikkan memori berarti', async () => {
    const bytes = await flatPng(20_000, 200);
    const out = await call(W, 'serialProofs.upload', {
      mime: 'image/png',
      bytes,
      width: 20_000,
      height: 200,
    });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('VALIDATION');
    const before = process.memoryUsage().rss;
    const error = await stampPhoto({ bytes, snapshot: SNAPSHOT as never }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as { code?: string } | null)?.code).toBe('VALIDATION');
    expect(process.memoryUsage().rss - before).toBeLessThan(80_000_000);
  });

  test('job foto sangat lebar: failed "terlalu besar" tanpa memuat berkas dan tanpa memakai percobaan', async () => {
    const stagedName = await seedDraft('p-wide', await flatPng(20_000, 200), 20_000, 200);
    const jobId = await queue('p-wide');
    const store = env.PROOF_STORE as NonNullable<typeof env.PROOF_STORE>;
    const read = store.read.bind(store);
    const readNames: string[] = [];
    store.read = async (name) => {
      readNames.push(name);
      return read(name);
    };
    expect(await runPendingJobs(env)).toBe(1);
    store.read = read;
    expect((await findJob(env, jobId))?.status).toBe('failed');
    const proof = await findProof(env.DB, 'p-wide');
    expect(proof?.state).toBe('failed');
    expect(proof?.lastError).toContain('terlalu besar');
    expect(proof?.attempts).toBe(0);
    expect(readNames).not.toContain(stagedName);
  });
});

describe('pemeriksaan ukuran hasil dekode', () => {
  test('assertProofSize: dimensi hasil dekode (mis. orientasi EXIF menukar sisi) melebihi kanvas = VALIDATION', () => {
    // 1000 x 4000 lolos sisi/luas (4 juta) dan kanvas portret; versi tertukar 4000 x 1000 melampaui kanvas (footer menurut lebar).
    expect(proofSizeError(1000, 4000)).toBeNull();
    expect(proofSizeError(4000, 1000)).not.toBeNull();
    expect(() => assertProofSize(1000, 4000)).not.toThrow();
    expect(() => assertProofSize(4000, 1000)).toThrow('Dimensi gambar terlalu besar');
    try {
      assertProofSize(4000, 1000);
    } catch (error) {
      expect((error as { code?: string }).code).toBe('VALIDATION');
    }
  });
});

describe('gagal karena ukuran tidak dapat dicoba lagi', () => {
  async function failedPhoto(id: string, width: number, height: number) {
    await seedDraft(id, await flatPng(8, 8), width, height);
    await env.DB.batch(claim(id));
    await setProofState(env.DB, id, { state: 'failed', now: NOW, lastError: 'x' }).run();
  }

  test('DTO: canRetry hanya bila canManage, failed, dan ukuran sah', async () => {
    await failedPhoto('p-small', 640, 480);
    await failedPhoto('p-huge', 3000, 3000);
    const small = await findProof(env.DB, 'p-small');
    const huge = await findProof(env.DB, 'p-huge');
    expect(toProofDto(small as never, true)).toMatchObject({ canManage: true, canRetry: true });
    expect(toProofDto(small as never, false)).toMatchObject({ canManage: false, canRetry: false });
    expect(toProofDto(huge as never, true)).toMatchObject({ canManage: true, canRetry: false });
    await setProofState(env.DB, 'p-small', { state: 'queued', now: NOW }).run();
    const queued = await findProof(env.DB, 'p-small');
    expect(toProofDto(queued as never, true).canRetry).toBe(false);
  });

  test('retry foto gagal karena ukuran: CONFLICT bermakna; Buang tetap boleh', async () => {
    await failedPhoto('p-huge', 3000, 3000);
    const retried = await call(W, 'serialProofs.retry', { id: 'p-huge' });
    expect(retried.ok).toBe(false);
    expect(retried.error?.code).toBe('CONFLICT');
    expect(retried.error?.message).toContain('Ukuran foto melebihi batas');
    expect(await jobCount()).toBe(0);
    expect((await call(W, 'serialProofs.remove', { id: 'p-huge' })).ok).toBe(true);
    expect(await findProof(env.DB, 'p-huge')).toBeNull();
  });

  test('foto gagal berukuran sah tetap dapat dicoba lagi', async () => {
    await failedPhoto('p-ok', 640, 480);
    const retried = await call(W, 'serialProofs.retry', { id: 'p-ok' });
    expect(retried.ok).toBe(true);
    expect(await jobCount()).toBe(1);
  });
});

describe('penyapu yatim: rujukan dan hitungan', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qc-proof-orphan2-'));
    env.PROOF_STORE = createProofStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function plantOld(name: string): Promise<string> {
    const target = join(dir, name);
    await writeFile(target, new Uint8Array([1]));
    const at = new Date(env.clock.now() - 3 * ORPHAN_MIN_AGE_MS);
    await utimes(target, at, at);
    return name;
  }
  const exists = async (name: string) =>
    (await env.PROOF_STORE?.list())?.some((file) => file.name === name) ?? false;

  async function photoWithState(
    id: string,
    state: 'draft' | 'queued' | 'processing' | 'failed' | 'done',
  ): Promise<string> {
    const name = await plantOld(newStagedName());
    await insertDraftStmt(env.DB, {
      id,
      createdBy: W,
      now: NOW,
      mime: 'image/png',
      width: 64,
      height: 48,
      size: 1,
      stagedName: name,
    }).run();
    if (state !== 'draft') {
      await env.DB.batch(claim(id));
      if (state !== 'queued') await setProofState(env.DB, id, { state, now: NOW }).run();
    }
    return name;
  }

  test('berkas milik baris done yang tertinggal tersapu; milik baris aktif atau failed tidak', async () => {
    const names = {
      done: await photoWithState('r-done', 'done'),
      draft: await photoWithState('r-draft', 'draft'),
      queued: await photoWithState('r-queued', 'queued'),
      processing: await photoWithState('r-processing', 'processing'),
      failed: await photoWithState('r-failed', 'failed'),
    };
    expect(await sweepOrphanProofFiles(env)).toBe(1);
    expect(await exists(names.done)).toBe(false);
    for (const kept of ['draft', 'queued', 'processing', 'failed'] as const) {
      expect([kept, await exists(names[kept])]).toEqual([kept, true]);
    }
  });

  test('hitungan hanya naik bila berkas benar-benar terhapus', async () => {
    const a = await plantOld(newStagedName());
    const b = await plantOld(newStagedName());
    const store = env.PROOF_STORE as NonNullable<typeof env.PROOF_STORE>;
    const real = store.removeOrphan.bind(store);
    store.removeOrphan = async (name) => {
      if (name === a) throw new Error('disk error');
      return real(name);
    };
    expect(await sweepOrphanProofFiles(env)).toBe(1);
    store.removeOrphan = real;
    expect(await exists(a)).toBe(true);
    expect(await exists(b)).toBe(false);
  });
});

describe('canManage menimbang serial: edit saat ini', () => {
  const user = (permission: 'none' | 'view' | 'edit' | 'manage', buManage = false) =>
    ({
      email: 'x@gmail.com',
      permissions: { serial: permission },
      businessUnits: { 'bu-a': { serial: buManage ? 'manage' : permission } },
    }) as never;

  test('pelaku tanpa serial: edit (dicabut) = false; dengan edit = true; manage pada BU = true', () => {
    expect(canManageProof(user('view'), 'x@gmail.com', 'bu-a')).toBe(false);
    expect(canManageProof(user('none'), 'x@gmail.com', 'bu-a')).toBe(false);
    expect(canManageProof(user('edit'), 'x@gmail.com', 'bu-a')).toBe(true);
    expect(canManageProof(user('edit'), 'lain@gmail.com', 'bu-a')).toBe(false);
    expect(canManageProof(user('manage', true), 'lain@gmail.com', 'bu-a')).toBe(true);
  });
});
