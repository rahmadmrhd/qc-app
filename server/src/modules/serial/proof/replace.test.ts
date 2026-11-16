import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { runPendingJobs } from '@server/jobs/runner';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SERIAL_PROOF_LIMITS } from '@shared/serials';
import { encodePngRgba } from './png';
import { claimDraftStmts, findProof, insertDraftStmt, setProofState, toProofDto } from './repo';
import {
  PROOF_MAX_CANVAS_PIXELS,
  type ProofSnapshot,
  proofSizeError,
  STAMP_LINE_COUNT,
  STAMP_LINE_COUNT_REUPLOAD,
  stampFooterHeight,
  stampLines,
} from './stamp';
import { newStagedName } from './store';
import { sweepExpiredFailedProofs } from './sweep';

// Unggah ulang foto bukti bermasalah (`serialProofs.replace`) dan cap dengan baris "Diunggah ulang".

setDefaultTimeout(120_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer; // serial: edit di BU A
const BOTH = SERIAL_USERS.both; // serial: edit di BU A dan B (bukan pelaku)
const VIEWER = SERIAL_USERS.viewer; // serial: view
const MANAGER = 'manajer@gmail.com'; // serial: manage di BU A
const T0 = '2026-11-20T03:00:00.000Z';
const DAY = 86_400_000;
const GENERIC = 'Foto tidak dikenal atau sudah dipakai';
const realError = console.error;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

const SNAPSHOT = {
  serial: 'AAA1',
  brand: 'Merk',
  model: 'Alfa',
  buCode: 'A',
  locationName: 'Surabaya',
  actorName: 'Pencatat',
  actorTeam: 'qc',
  savedAt: '2026-11-19T03:00:00.000Z',
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse(T0));
  await seedSerialWorld(env);
  await seedRole(env, { id: 'r-manage', name: 'Serial manage', permissions: { serial: 'manage' } });
  await seedUser(env, {
    id: 'u-mgr',
    email: MANAGER,
    name: 'Manajer Mutu',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-manage'] }],
  });
  await env.DB.prepare("UPDATE users SET name = 'Wati Pencatat' WHERE email = ?").bind(W).run();
  await seedSerial(env, { id: 'sn-a', serial: 'AAA1', buId: 'bu-a' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

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

/** PNG berkepala sah tetapi tanpa isi gambar: lolos unggah, gagal di cap (permanen). */
function headerOnlyPng(width = 64, height = 48): Uint8Array {
  const be32 = (value: number) => [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ];
  const head = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
  ];
  const out = new Uint8Array(100);
  for (let i = 0; i < out.length; i++) out[i] = (i * 31 + 7) % 256;
  out.set(head, 0);
  return out;
}

async function upload(email: string, bytes: Uint8Array, width = 64, height = 48): Promise<string> {
  const out = await call(email, 'serialProofs.upload', { mime: 'image/png', bytes, width, height });
  expect(out.ok).toBe(true);
  return out.data.id as string;
}

/** Foto `failed` langsung di basis data (milik `owner`, pada `sn-a`) dengan berkas sementara; tanpa lewat Simpan. */
async function seedFailed(
  id: string,
  options: { owner?: string; width?: number; height?: number; now?: string } = {},
): Promise<string> {
  const owner = options.owner ?? W;
  const stagedName = newStagedName();
  await env.PROOF_STORE?.write(stagedName, new TextEncoder().encode('isi asli'));
  await insertDraftStmt(env.DB, {
    id,
    createdBy: owner,
    now: T0,
    mime: 'image/png',
    width: options.width ?? 64,
    height: options.height ?? 48,
    size: 8,
    stagedName,
  }).run();
  await env.DB.batch(
    claimDraftStmts(env.DB, {
      ids: [id],
      email: owner,
      serialId: 'sn-a',
      eventId: `ev-${id}`,
      snapshotJson: JSON.stringify(SNAPSHOT),
      now: T0,
    }),
  );
  await setProofState(env.DB, id, {
    state: 'failed',
    now: options.now ?? T0,
    lastError: 'Berkas bukan gambar yang dapat diproses',
  }).run();
  return stagedName;
}

const proofJobs = () => rows("SELECT id, input FROM jobs WHERE kind = 'serial_proof'");
const stagedExists = async (name: string) => (await env.PROOF_STORE?.stat(name)) != null;

describe('serialProofs.replace: sukses', () => {
  test('foto lama hilang, pengganti queued dengan serial/kejadian/snapshot lama + reupload, job terpasang, audit tercatat', async () => {
    const oldStaged = await seedFailed('old1');
    const newId = await upload(W, await realPng());
    const newRow = await findProof(env.DB, newId);
    const out = await call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId: newId });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({
      id: newId,
      state: 'queued',
      error: null,
      canManage: true,
      failedAt: null,
      expiresAt: null,
    });
    expect(await findProof(env.DB, 'old1')).toBeNull();
    const row = await findProof(env.DB, newId);
    expect(row).toMatchObject({
      state: 'queued',
      serialId: 'sn-a',
      eventId: 'ev-old1',
      createdBy: W,
      stagedName: newRow?.stagedName,
    });
    expect(JSON.parse(row?.snapshotJson ?? '{}')).toEqual({
      ...SNAPSHOT,
      reupload: { at: T0, byName: 'Wati Pencatat' },
    });
    // berkas lama dibuang; berkas pengganti utuh
    expect(await stagedExists(oldStaged)).toBe(false);
    expect(await stagedExists(newRow?.stagedName ?? '')).toBe(true);
    // tepat satu job untuk foto pengganti
    expect((await proofJobs()).map((job) => JSON.parse(job.input))).toEqual([{ photoId: newId }]);
    // audit
    const audit = await rows("SELECT * FROM audit_log WHERE action = 'serial.proof_reupload'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: W, target: 'serial:sn-a' });
    expect(JSON.parse(audit[0].before)).toMatchObject({ id: 'old1', eventId: 'ev-old1' });
    expect(JSON.parse(audit[0].after)).toEqual({ id: newId });
  });

  test('ujung ke ujung: gagal lewat Simpan, unggah ulang, job selesai; cap punya baris tambahan; banner/jumlah hilang', async () => {
    const photoId = await upload(W, headerOnlyPng());
    const saved = await call(W, 'serials.saveBatch', {
      rows: [
        {
          clientId: 'client-000001',
          serial: 'SN-REUP',
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
    expect(saved.ok).toBe(true);
    const serialId = saved.data.results[0].id as string;
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findProof(env.DB, photoId))?.state).toBe('failed');
    const before = await call(W, 'serials.get', { id: serialId });
    expect(before.data.serial.proofProblemCount).toBe(1);
    const failedDto = before.data.events.find((e: Json) => e.type === 'recorded').proofPhotos[0];
    expect(failedDto).toMatchObject({ state: 'failed', canManage: true });
    expect(Date.parse(failedDto.expiresAt) - Date.parse(failedDto.failedAt)).toBe(
      SERIAL_PROOF_LIMITS.failedRetentionDays * DAY,
    );

    env.clock.set(Date.parse('2026-11-21T08:15:00.000Z')); // 15:15 WIB
    const newId = await upload(W, await realPng());
    const replaced = await call(W, 'serialProofs.replace', { photoId, newPhotoId: newId });
    expect(replaced.ok).toBe(true);
    expect(await runPendingJobs(env)).toBe(1);
    const done = await findProof(env.DB, newId);
    expect(done?.state).toBe('done');
    // footer lima baris (satu lebih tinggi dari foto biasa)
    expect(done?.height).toBe(48 + stampFooterHeight(64, STAMP_LINE_COUNT_REUPLOAD));
    expect(stampFooterHeight(64, STAMP_LINE_COUNT_REUPLOAD)).toBeGreaterThan(
      stampFooterHeight(64, STAMP_LINE_COUNT),
    );
    const after = await call(W, 'serials.get', { id: serialId });
    expect(after.data.serial.proofProblemCount).toBe(0);
    const photos = after.data.events.find((e: Json) => e.type === 'recorded').proofPhotos;
    expect(photos.map((p: Json) => [p.id, p.state])).toEqual([[newId, 'done']]);
    // satu-satunya notifikasi = dari kegagalan pertama
    expect(
      await rows("SELECT proof_id FROM notifications WHERE kind = 'serialProofFailed'"),
    ).toHaveLength(1);
  });

  test('jumlah foto pada kejadian tidak bertambah (kuota 5 tetap): pengganti menggantikan satu', async () => {
    for (let i = 0; i < SERIAL_PROOF_LIMITS.perEntryMax - 1; i++) {
      await seedFailed(`full-${i}`);
      await env.DB.prepare("UPDATE serial_proof_photos SET event_id = 'ev-old1' WHERE id = ?")
        .bind(`full-${i}`)
        .run();
      await setProofState(env.DB, `full-${i}`, { state: 'done', now: T0 }).run();
    }
    await seedFailed('old1');
    const count = async () =>
      Number(
        (await rows("SELECT COUNT(*) AS n FROM serial_proof_photos WHERE event_id = 'ev-old1'"))[0]
          .n,
      );
    expect(await count()).toBe(SERIAL_PROOF_LIMITS.perEntryMax);
    const newId = await upload(W, await realPng());
    expect((await call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId: newId })).ok).toBe(
      true,
    );
    expect(await count()).toBe(SERIAL_PROOF_LIMITS.perEntryMax);
  });

  test('foto gagal karena ukuran (canRetry false) tetap dapat diganti', async () => {
    const stagedName = await seedFailed('huge', { width: 3000, height: 3000 });
    const dto = toProofDto((await findProof(env.DB, 'huge')) as never, true);
    expect(dto).toMatchObject({ canManage: true, canRetry: false });
    const newId = await upload(W, await realPng());
    const out = await call(W, 'serialProofs.replace', { photoId: 'huge', newPhotoId: newId });
    expect(out.ok).toBe(true);
    expect(await findProof(env.DB, 'huge')).toBeNull();
    expect(await stagedExists(stagedName)).toBe(false);
  });

  test('pemegang serial: manage pada BU entri (bukan pelaku) boleh mengganti; pengganti milik pengganti', async () => {
    await seedFailed('old1');
    const newId = await upload(MANAGER, await realPng());
    const out = await call(MANAGER, 'serialProofs.replace', { photoId: 'old1', newPhotoId: newId });
    expect(out.ok).toBe(true);
    const row = await findProof(env.DB, newId);
    expect(row?.createdBy).toBe(MANAGER);
    expect(JSON.parse(row?.snapshotJson ?? '{}').reupload).toEqual({
      at: T0,
      byName: 'Manajer Mutu',
    });
  });
});

describe('serialProofs.replace: penolakan (tak ada yang berubah)', () => {
  async function untouched(oldId: string, oldStaged: string, newId?: string): Promise<void> {
    expect((await findProof(env.DB, oldId))?.state).toBe('failed');
    expect(await stagedExists(oldStaged)).toBe(true);
    expect(await proofJobs()).toHaveLength(0);
    expect(
      await rows("SELECT id FROM audit_log WHERE action = 'serial.proof_reupload'"),
    ).toHaveLength(0);
    if (newId) expect((await findProof(env.DB, newId))?.state).toBe('draft');
  }

  test('bukan pelaku dan tanpa serial: manage ditolak (NOT_FOUND)', async () => {
    const oldStaged = await seedFailed('old1');
    const newId = await upload(BOTH, await realPng());
    const out = await call(BOTH, 'serialProofs.replace', { photoId: 'old1', newPhotoId: newId });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('NOT_FOUND');
    await untouched('old1', oldStaged, newId);
  });

  test('hanya pembaca (serial: view) ditolak oleh izin rute', async () => {
    const oldStaged = await seedFailed('old1');
    const out = await call(VIEWER, 'serialProofs.replace', { photoId: 'old1', newPhotoId: 'x' });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('FORBIDDEN');
    await untouched('old1', oldStaged);
  });

  test('foto lama bukan failed (queued, done, draft) ditolak', async () => {
    for (const state of ['queued', 'processing', 'done'] as const) {
      await seedFailed(`o-${state}`);
      await setProofState(env.DB, `o-${state}`, { state, now: T0 }).run();
      const newId = await upload(W, await realPng());
      const out = await call(W, 'serialProofs.replace', {
        photoId: `o-${state}`,
        newPhotoId: newId,
      });
      expect([state, out.ok, out.error?.code]).toEqual([state, false, 'CONFLICT']);
      expect((await findProof(env.DB, newId))?.state).toBe('draft');
      expect((await findProof(env.DB, `o-${state}`))?.state).toBe(state);
    }
    // draft milik pemanggil sebagai foto lama
    const draftOld = await upload(W, await realPng());
    const anotherNew = await upload(W, await realPng());
    const out = await call(W, 'serialProofs.replace', {
      photoId: draftOld,
      newPhotoId: anotherNew,
    });
    expect(out.ok).toBe(false);
    expect(await proofJobs()).toHaveLength(0);
  });

  test('draft pengganti: milik orang lain, tak ada, sudah diklaim, atau foto lama sendiri = galat generik yang sama', async () => {
    const oldStaged = await seedFailed('old1');
    const others = await upload(BOTH, await realPng());
    await seedFailed('queued-1');
    await setProofState(env.DB, 'queued-1', { state: 'queued', now: T0 }).run();
    const messages: string[] = [];
    for (const newPhotoId of [others, 'tidak-ada', 'queued-1', 'old1']) {
      const out = await call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId });
      expect([newPhotoId, out.ok, out.error?.code]).toEqual([newPhotoId, false, 'VALIDATION']);
      messages.push(out.error?.message);
    }
    expect(new Set(messages)).toEqual(new Set([GENERIC]));
    expect((await findProof(env.DB, others))?.state).toBe('draft');
    await untouched('old1', oldStaged);
  });

  test('pengganti terlalu besar bagi footer lima baris ditolak (lebih ketat daripada empat baris)', async () => {
    const oldStaged = await seedFailed('old1');
    // cari tinggi yang lolos untuk 4 baris tetapi tidak untuk 5 baris pada lebar 2000
    const width = 4000;
    const height = Math.floor(PROOF_MAX_CANVAS_PIXELS / width) - stampFooterHeight(width, 4);
    expect(proofSizeError(width, height, 4)).toBeNull();
    expect(proofSizeError(width, height, 5)).not.toBeNull();
    const newId = newStagedName();
    await insertDraftStmt(env.DB, {
      id: 'wide',
      createdBy: W,
      now: T0,
      mime: 'image/png',
      width,
      height,
      size: 8,
      stagedName: newId,
    }).run();
    const out = await call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId: 'wide' });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('VALIDATION');
    await untouched('old1', oldStaged, 'wide');
  });

  test('snapshot lama tak terbaca: CONFLICT bermakna, tak ada yang berubah', async () => {
    const oldStaged = await seedFailed('old1');
    await env.DB.prepare(
      "UPDATE serial_proof_photos SET snapshot_json = '{' WHERE id = 'old1'",
    ).run();
    const newId = await upload(W, await realPng());
    const out = await call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId: newId });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('CONFLICT');
    await untouched('old1', oldStaged, newId);
  });
});

describe('serialProofs.replace: keserempakan dan atomik', () => {
  /** Membungkus `env.DB.batch` agar `before()` berjalan tepat sebelum batch (mensimulasikan pihak lain yang menyela). */
  function interceptBatch(before: () => Promise<unknown>): void {
    const db = env.DB as unknown as { batch: (statements: unknown[]) => Promise<unknown> };
    const original = db.batch.bind(env.DB);
    let fired = false;
    db.batch = async (statements: unknown[]) => {
      if (!fired) {
        fired = true;
        await before();
      }
      return original(statements);
    };
  }

  test('foto lama keburu dicoba ulang sebelum batch: CONFLICT bermakna, berkas lama dan draft utuh', async () => {
    const oldStaged = await seedFailed('old1');
    const newId = await upload(W, await realPng());
    interceptBatch(async () => {
      await setProofState(env.DB, 'old1', { state: 'queued', now: T0 }).run();
    });
    const out = await call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId: newId });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('CONFLICT');
    expect(out.error?.message).toContain('Muat ulang');
    expect((await findProof(env.DB, 'old1'))?.state).toBe('queued');
    expect(await stagedExists(oldStaged)).toBe(true);
    expect((await findProof(env.DB, newId))?.state).toBe('draft');
    expect(await proofJobs()).toHaveLength(0);
  });

  test('foto lama keburu dibuang sebelum batch: CONFLICT; pengganti tetap draft', async () => {
    await seedFailed('old1');
    const newId = await upload(W, await realPng());
    interceptBatch(async () => {
      await env.DB.prepare('DELETE FROM serial_proof_photos WHERE id = ?').bind('old1').run();
    });
    const out = await call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId: newId });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('CONFLICT');
    expect((await findProof(env.DB, newId))?.state).toBe('draft');
    expect(await proofJobs()).toHaveLength(0);
  });

  test('draft pengganti keburu disapu sebelum batch: seluruh batch dibatalkan (foto lama tetap failed, berkas utuh)', async () => {
    const oldStaged = await seedFailed('old1');
    const newId = await upload(W, await realPng());
    interceptBatch(async () => {
      await env.DB.prepare('DELETE FROM serial_proof_photos WHERE id = ?').bind(newId).run();
    });
    const out = await call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId: newId });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('VALIDATION');
    expect(out.error?.message).toBe(GENERIC);
    expect((await findProof(env.DB, 'old1'))?.state).toBe('failed');
    expect(await stagedExists(oldStaged)).toBe(true);
    expect(await proofJobs()).toHaveLength(0);
    expect(
      await rows("SELECT id FROM audit_log WHERE action = 'serial.proof_reupload'"),
    ).toHaveLength(0);
  });

  test('replace vs Buang serentak: tepat satu menang; keadaan akhir konsisten', async () => {
    for (let round = 0; round < 3; round++) {
      const oldId = `race-rm-${round}`;
      const oldStaged = await seedFailed(oldId);
      const newId = await upload(W, await realPng());
      const [replaced, removed] = await Promise.all([
        call(W, 'serialProofs.replace', { photoId: oldId, newPhotoId: newId }),
        call(W, 'serialProofs.remove', { id: oldId }),
      ]);
      expect([round, replaced.ok || removed.ok]).toEqual([round, true]);
      expect(await findProof(env.DB, oldId)).toBeNull();
      expect(await stagedExists(oldStaged)).toBe(false);
      const row = await findProof(env.DB, newId);
      if (replaced.ok) {
        expect(row?.state).toBe('queued');
      } else {
        expect(replaced.error?.code).toBe('CONFLICT');
        expect(row?.state).toBe('draft');
      }
      const jobs = (await proofJobs()).filter((job) => job.input.includes(newId));
      expect(jobs).toHaveLength(replaced.ok ? 1 : 0);
    }
  });

  test('replace vs Coba lagi serentak: tepat satu menang; foto lama tak pernah ganda diproses', async () => {
    for (let round = 0; round < 3; round++) {
      const oldId = `race-rt-${round}`;
      const oldStaged = await seedFailed(oldId);
      const newId = await upload(W, await realPng());
      const [replaced, retried] = await Promise.all([
        call(W, 'serialProofs.replace', { photoId: oldId, newPhotoId: newId }),
        call(W, 'serialProofs.retry', { id: oldId }),
      ]);
      expect([round, replaced.ok !== retried.ok]).toEqual([round, true]);
      const jobs = await proofJobs();
      if (replaced.ok) {
        expect(await findProof(env.DB, oldId)).toBeNull();
        expect(await stagedExists(oldStaged)).toBe(false);
        expect(jobs.filter((job) => job.input.includes(newId))).toHaveLength(1);
        expect(jobs.filter((job) => job.input.includes(oldId))).toHaveLength(0);
      } else {
        expect((await findProof(env.DB, oldId))?.state).toBe('queued');
        expect(await stagedExists(oldStaged)).toBe(true);
        expect((await findProof(env.DB, newId))?.state).toBe('draft');
        expect(jobs.filter((job) => job.input.includes(oldId))).toHaveLength(1);
        expect(jobs.filter((job) => job.input.includes(newId))).toHaveLength(0);
      }
    }
  });

  test('replace vs sapuan retensi serentak: tepat satu menghapus foto lama; berkas lama hanya dibuang oleh yang menang', async () => {
    for (let round = 0; round < 3; round++) {
      const oldId = `race-sw-${round}`;
      const oldStaged = await seedFailed(oldId, {
        now: new Date(Date.parse(T0) - 15 * DAY).toISOString(),
      });
      const newId = await upload(W, await realPng());
      const [replaced] = await Promise.all([
        call(W, 'serialProofs.replace', { photoId: oldId, newPhotoId: newId }),
        sweepExpiredFailedProofs(env),
      ]);
      expect(await findProof(env.DB, oldId)).toBeNull();
      expect(await stagedExists(oldStaged)).toBe(false);
      const row = await findProof(env.DB, newId);
      expect(row?.state).toBe(replaced.ok ? 'queued' : 'draft');
      if (!replaced.ok) expect(['CONFLICT', 'NOT_FOUND']).toContain(replaced.error?.code);
    }
  });

  test('dua unggah ulang serentak atas foto yang sama: hanya satu menang, draft yang kalah tetap draft', async () => {
    const oldStaged = await seedFailed('old1');
    const first = await upload(W, await realPng());
    const second = await upload(W, await realPng());
    const [one, two] = await Promise.all([
      call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId: first }),
      call(W, 'serialProofs.replace', { photoId: 'old1', newPhotoId: second }),
    ]);
    expect(one.ok !== two.ok).toBe(true);
    const winner = one.ok ? first : second;
    const loser = one.ok ? second : first;
    expect((await findProof(env.DB, winner))?.state).toBe('queued');
    expect((await findProof(env.DB, loser))?.state).toBe('draft');
    expect(await findProof(env.DB, 'old1')).toBeNull();
    expect(await stagedExists(oldStaged)).toBe(false);
    expect(await proofJobs()).toHaveLength(1);
  });
});

describe('cap foto unggah ulang', () => {
  const base: ProofSnapshot = {
    serial: 'AAA1',
    brand: 'Merk',
    model: 'Alfa',
    buCode: 'A',
    locationName: 'Surabaya',
    actorName: 'Pencatat',
    actorTeam: 'qc',
    savedAt: '2026-11-19T03:00:00.000Z',
  };

  test('foto biasa tetap empat baris persis seperti semula', () => {
    expect(stampLines(base)).toEqual([
      'SN: AAA1',
      'Merk Alfa',
      'A · Surabaya',
      'Disimpan 19 Nov 2026 10:00 WIB · Pencatat (QC)',
    ]);
    // penanda rusak/ kosong tidak menambah baris
    expect(stampLines({ ...base, reupload: undefined })).toHaveLength(4);
    expect(stampLines({ ...base, reupload: { at: 5 as never, byName: 'x' } })).toHaveLength(4);
  });

  test('foto unggah ulang: baris terakhir "Diunggah ulang <tgl jam> WIB · <nama>" (nama dilipat)', () => {
    const lines = stampLines({
      ...base,
      reupload: { at: '2026-11-21T08:15:00.000Z', byName: 'Sri Wahyuní' },
    });
    expect(lines).toHaveLength(5);
    expect(lines.slice(0, 4)).toEqual(stampLines(base));
    expect(lines[4]).toBe('Diunggah ulang 21 Nov 2026 15:15 WIB · Sri Wahyuni');
  });

  test('tinggi footer dan batas ukuran memperhitungkan jumlah baris', () => {
    expect(stampFooterHeight(640)).toBe(stampFooterHeight(640, STAMP_LINE_COUNT));
    expect(stampFooterHeight(640, 5)).toBeGreaterThan(stampFooterHeight(640, 4));
    expect(proofSizeError(2100, 2000)).toBeNull();
    expect(proofSizeError(2100, 2000, 5)).toBeNull();
    // batas kanvas lebih ketat untuk lima baris
    const width = 4000;
    const maxH4 = Math.floor(PROOF_MAX_CANVAS_PIXELS / width) - stampFooterHeight(width, 4);
    expect(proofSizeError(width, maxH4, 4)).toBeNull();
    expect(proofSizeError(width, maxH4, 5)).not.toBeNull();
  });

  test('gambar penuh: stampPhoto dengan reupload menghasilkan tinggi + footer lima baris', async () => {
    const { stampPhoto } = await import('./stamp');
    const bytes = await realPng(320, 200);
    const plain = await stampPhoto({ bytes, snapshot: base });
    const reup = await stampPhoto({
      bytes,
      snapshot: { ...base, reupload: { at: '2026-11-21T08:15:00.000Z', byName: 'Sri' } },
    });
    expect(plain.height).toBe(200 + stampFooterHeight(320, 4));
    expect(reup.height).toBe(200 + stampFooterHeight(320, 5));
    expect(reup.height).toBeGreaterThan(plain.height);
  });
});

describe('rute REST', () => {
  test('POST /serial-proofs/{photoId}/replace dengan badan JSON mengembalikan 200 dan DTO foto pengganti', async () => {
    await seedFailed('old1');
    const newId = await upload(W, await realPng());
    const response = await restClient(env).post('/serial-proofs/old1/replace', {
      email: W,
      body: { newPhotoId: newId },
    });
    expect(response.status).toBe(200);
    const body = await jsonOf(response);
    expect(body).toMatchObject({ id: newId, state: 'queued' });
    expect(Object.keys(body).sort()).toEqual([
      'canManage',
      'canRetry',
      'error',
      'expiresAt',
      'failedAt',
      'filename',
      'height',
      'id',
      'mime',
      'size',
      'state',
      'width',
    ]);
  });

  test('badan tanpa newPhotoId atau dengan kunci asing ditolak validator', async () => {
    await seedFailed('old1');
    const missing = await call(W, 'serialProofs.replace', { photoId: 'old1' });
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe('VALIDATION');
    const extra = await call(W, 'serialProofs.replace', {
      photoId: 'old1',
      newPhotoId: 'x',
      serialId: 'y',
    });
    expect(extra.ok).toBe(false);
    expect(extra.error?.code).toBe('VALIDATION');
  });
});
