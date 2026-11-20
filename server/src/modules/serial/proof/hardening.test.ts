import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPendingJobs, startScheduler } from '@server/jobs/runner';
import { findJob } from '@server/modules/jobs/repo';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { removeTempDir } from '../../../../test-support/safe-rm';
import { serialProofJobStmt } from './job';
import { encodePngRgba } from './png';
import {
  claimDraftStmts,
  deleteDraftStmt,
  findProof,
  insertDraftStmt,
  setProofState,
} from './repo';
import { PROOF_MAX_PIXELS, stampPhoto } from './stamp';
import { createProofStore, newStagedName } from './store';
import { ORPHAN_MIN_AGE_MS, PARTIAL_MIN_AGE_MS, sweepOrphanProofFiles } from './sweep';

// Putaran perbaikan D1 (review akhir): batas piksel, hitungan percobaan permanen, hapus/retry bersyarat, penyapu
// berkas yatim, penjaga klaim foto pada `serials.act`, dan `canManage` pada DTO.

setDefaultTimeout(90_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer;
const VIEWER = SERIAL_USERS.viewer;
const OTHER = SERIAL_USERS.both; // serial: edit di BU A dan B (bukan manage)
const MANAGER = 'manajer@gmail.com';
const NOW = '2026-11-20T03:00:00.000Z';
const HOUR = 3_600_000;
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
  await seedRole(env, { id: 'r-manage', name: 'Serial manage', permissions: { serial: 'manage' } });
  await seedUser(env, {
    id: 'u-mgr',
    email: MANAGER,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-manage'] }],
  });
  await seedSerial(env, { id: 'sn-a', serial: 'AAA1', buId: 'bu-a' });
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, '')",
  ).run();
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

/** PNG nyata berisi nol (kecil di disk, besar saat didekode). */
async function flatPng(width: number, height: number): Promise<Uint8Array> {
  return encodePngRgba({ width, height, rgba: new Uint8Array(width * height * 4) });
}

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

/** Foto `draft` dengan isi berkas apa pun (melewati validasi unggah). */
async function seedDraft(id: string, bytes: Uint8Array, owner = W, claimedW = 64, claimedH = 48) {
  const stagedName = newStagedName();
  await env.PROOF_STORE?.write(stagedName, bytes);
  await insertDraftStmt(env.DB, {
    id,
    createdBy: owner,
    now: NOW,
    mime: 'image/png',
    width: claimedW,
    height: claimedH,
    size: bytes.length,
    stagedName,
  }).run();
  return stagedName;
}

const claim = (id: string, owner = W) =>
  claimDraftStmts(env.DB, {
    ids: [id],
    email: owner,
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

const proofJobCount = async () =>
  (await rows("SELECT id FROM jobs WHERE kind = 'serial_proof'")).length;

describe('K1: batas piksel dan percobaan permanen', () => {
  test('PROOF_MAX_PIXELS = 4,2 juta (cukup untuk 2048 x 2048)', () => {
    expect(PROOF_MAX_PIXELS).toBe(4_200_000);
    expect(2048 * 2048).toBeLessThanOrEqual(PROOF_MAX_PIXELS);
  });

  test('PNG polos 3000 x 3000 (kecil di disk) ditolak saat unggah', async () => {
    const bytes = await flatPng(3000, 3000);
    expect(bytes.length).toBeLessThan(200_000);
    const out = await call(W, 'serialProofs.upload', {
      mime: 'image/png',
      bytes,
      width: 3000,
      height: 3000,
    });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('VALIDATION');
    expect(await rows('SELECT id FROM serial_proof_photos')).toHaveLength(0);
    expect(await env.PROOF_STORE?.totalBytes()).toBe(0);
  });

  test('klaim lebar/tinggi kecil tidak menyelamatkan gambar besar: dimensi dibaca dari header', async () => {
    const out = await call(W, 'serialProofs.upload', {
      mime: 'image/png',
      bytes: await flatPng(3000, 3000),
      width: 640,
      height: 480,
    });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('VALIDATION');
  });

  test('stampPhoto menolak gambar di atas batas tanpa menaikkan memori berarti', async () => {
    const bytes = await flatPng(3000, 3000);
    const before = process.memoryUsage().rss;
    const error = await stampPhoto({ bytes, snapshot: SNAPSHOT as never }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as { code?: string } | null)?.code).toBe('VALIDATION');
    expect(process.memoryUsage().rss - before).toBeLessThan(80_000_000);
  });

  test('foto lama di antrean di atas batas langsung failed dengan alasan (bukan memuat)', async () => {
    await seedDraft('p-big', await flatPng(3000, 3000));
    const jobId = await queue('p-big');
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, jobId))?.status).toBe('failed');
    const proof = await findProof(env.DB, 'p-big');
    expect(proof?.state).toBe('failed');
    expect(proof?.lastError).toContain('terlalu besar');
    expect(await env.PROOF_STORE?.stat(proof?.stagedName as string)).not.toBeNull();
  });

  test('attempts naik permanen saat langkah 0 memuat gambar; lewat batas = failed tanpa memuat', async () => {
    const png = await gradientPng();
    await seedDraft('p-ok', png);
    await queue('p-ok');
    await runPendingJobs(env);
    const ok = await findProof(env.DB, 'p-ok');
    expect(ok?.state).toBe('done');
    expect(ok?.attempts).toBe(1);

    // proses "mati" berulang pada langkah 0 (simulasi: attempts sudah 3 di basis data)
    const stagedName = await seedDraft('p-dead', png);
    const jobId = await queue('p-dead');
    await env.DB.prepare('UPDATE serial_proof_photos SET attempts = 3 WHERE id = ?')
      .bind('p-dead')
      .run();
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
    const dead = await findProof(env.DB, 'p-dead');
    expect(dead?.state).toBe('failed');
    expect(dead?.lastError).toContain('berulang kali');
    expect(dead?.attempts).toBe(4);
    expect(readNames).not.toContain(stagedName); // gambar tak dimuat
    // retry mengembalikan hitungan ke 0 dan memprosesnya
    const retried = await call(W, 'serialProofs.retry', { id: 'p-dead' });
    expect(retried.ok).toBe(true);
    expect((await findProof(env.DB, 'p-dead'))?.attempts).toBe(0);
    await runPendingJobs(env);
    expect((await findProof(env.DB, 'p-dead'))?.state).toBe('done');
  });

  test('tepat di bawah batas (attempts = 2) masih diproses', async () => {
    await seedDraft('p-two', await gradientPng());
    await queue('p-two');
    await env.DB.prepare('UPDATE serial_proof_photos SET attempts = 2 WHERE id = ?')
      .bind('p-two')
      .run();
    await runPendingJobs(env);
    const proof = await findProof(env.DB, 'p-two');
    expect(proof?.state).toBe('done');
    expect(proof?.attempts).toBe(3);
  });
});

describe('I1: remove bersyarat', () => {
  test('deleteDraftStmt tidak menghapus foto yang sudah diklaim atau milik orang lain', async () => {
    await seedDraft('p1', await gradientPng());
    await env.DB.batch(claim('p1'));
    expect((await deleteDraftStmt(env.DB, 'p1', W).run()).meta?.changes).toBe(0);
    await seedDraft('p2', await gradientPng());
    expect((await deleteDraftStmt(env.DB, 'p2', OTHER).run()).meta?.changes).toBe(0);
    expect(await findProof(env.DB, 'p1')).not.toBeNull();
    expect(await findProof(env.DB, 'p2')).not.toBeNull();
  });

  test('remove draft yang keburu diklaim Simpan: CONFLICT, foto dan berkas tetap', async () => {
    const staged = await seedDraft('p1', await gradientPng());
    await env.DB.batch(claim('p1'));
    const out = await call(W, 'serialProofs.remove', { id: 'p1' });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('CONFLICT');
    expect(await env.PROOF_STORE?.stat(staged)).not.toBeNull();
    expect((await findProof(env.DB, 'p1'))?.state).toBe('queued');
  });

  test('balapan Promise.all([remove, saveBatch]): kejadian tersimpan SELALU berfoto, atau foto dibuang dan simpan ditolak', async () => {
    for (let round = 0; round < 4; round++) {
      const id = `race-${round}`;
      const staged = await seedDraft(id, await gradientPng());
      const [removed, saved] = await Promise.all([
        call(W, 'serialProofs.remove', { id }),
        call(W, 'serials.saveBatch', {
          rows: [
            {
              clientId: `client-${String(round + 10).padStart(6, '0')}`,
              serial: `SN-R${round}`,
              itemId: 'i-a1',
              buId: 'bu-a',
              testDate: '2026-11-20',
              locationId: 'loc-sby',
              sample: false,
              note: '',
              proofPhotoIds: [id],
            },
          ],
        }),
      ]);
      const created = saved.data.results[0].result === 'created';
      const proof = await findProof(env.DB, id);
      if (created) {
        // Simpan menang: foto tertaut dan tetap ada; remove ditolak
        expect(removed.ok).toBe(false);
        expect(proof?.state).toBe('queued');
        expect(await env.PROOF_STORE?.stat(staged)).not.toBeNull();
        expect(
          await rows(
            "SELECT id FROM jobs WHERE kind = 'serial_proof' AND input = ?",
            JSON.stringify({ photoId: id }),
          ),
        ).toHaveLength(1);
      } else {
        // remove menang: foto dan berkas hilang, tidak ada serial/job yatim
        expect(removed.ok).toBe(true);
        expect(proof).toBeNull();
        expect(await env.PROOF_STORE?.stat(staged)).toBeNull();
        expect(await rows('SELECT id FROM serials WHERE serial = ?', `SN-R${round}`)).toHaveLength(
          0,
        );
      }
    }
  });

  test('remove foto failed: audit tercatat; yang keburu dicoba ulang tidak terhapus', async () => {
    await seedDraft('pf', await gradientPng());
    await env.DB.batch(claim('pf'));
    await setProofState(env.DB, 'pf', { state: 'failed', now: NOW, lastError: 'rusak' }).run();
    const [removeResult, retryResult] = await Promise.all([
      call(W, 'serialProofs.remove', { id: 'pf' }),
      call(W, 'serialProofs.retry', { id: 'pf' }),
    ]);
    const proof = await findProof(env.DB, 'pf');
    if (removeResult.ok) {
      expect(retryResult.ok).toBe(false);
      expect(proof).toBeNull();
      expect(await proofJobCount()).toBe(0);
      expect(
        await rows("SELECT id FROM audit_log WHERE action = 'serial.proof_remove'"),
      ).toHaveLength(1);
    } else {
      expect(removeResult.error?.code).toBe('CONFLICT');
      expect(retryResult.ok).toBe(true);
      expect(proof?.state).toBe('queued');
      expect(await proofJobCount()).toBe(1);
      expect(
        await rows("SELECT id FROM audit_log WHERE action = 'serial.proof_remove'"),
      ).toHaveLength(0);
    }
  });
});

describe('M1: retry serentak', () => {
  test('dua Coba lagi serentak: satu berhasil, satu CONFLICT, tepat satu job', async () => {
    await seedDraft('pr', await gradientPng());
    await env.DB.batch(claim('pr'));
    await setProofState(env.DB, 'pr', { state: 'failed', now: NOW, lastError: 'rusak' }).run();
    const [a, b] = await Promise.all([
      call(W, 'serialProofs.retry', { id: 'pr' }),
      call(MANAGER, 'serialProofs.retry', { id: 'pr' }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.error?.code).toBe('CONFLICT');
    expect(await proofJobCount()).toBe(1);
    expect((await findProof(env.DB, 'pr'))?.state).toBe('queued');
  });
});

describe('I2: penyapu berkas yatim', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qc-proof-orphan-'));
    env.PROOF_STORE = createProofStore(dir);
  });

  afterEach(async () => {
    // Penjaga: bila `beforeEach` luar gagal (mis. koneksi DB putus), `dir` masih '' dan `rm('')` menghapus isi direktori kerja.
    if (dir) await removeTempDir(dir);
    dir = '';
  });

  /** Menulis berkas `name` dengan waktu ubah `ageMs` sebelum jam uji. */
  async function plant(name: string, ageMs: number): Promise<string> {
    const target = join(dir, name);
    await writeFile(target, new Uint8Array([1, 2, 3]));
    const at = new Date(env.clock.now() - ageMs);
    await utimes(target, at, at);
    return name;
  }
  const exists = async (name: string) =>
    (await env.PROOF_STORE?.list())?.some((file) => file.name === name) ?? false;

  async function plantAll() {
    const names = {
      orphanOld: await plant(newStagedName(), ORPHAN_MIN_AGE_MS + HOUR),
      orphanYoung: await plant(newStagedName(), ORPHAN_MIN_AGE_MS - HOUR),
      referenced: await plant(newStagedName(), 3 * ORPHAN_MIN_AGE_MS),
      stamped: await plant(newStagedName(), 3 * ORPHAN_MIN_AGE_MS),
      partialOld: await plant(
        `${newStagedName()}.${newStagedName()}.partial`,
        PARTIAL_MIN_AGE_MS + 60_000,
      ),
      partialYoung: await plant(
        `${newStagedName()}.${newStagedName()}.partial`,
        PARTIAL_MIN_AGE_MS - 60_000,
      ),
      stranger: await plant('catatan.txt', 5 * ORPHAN_MIN_AGE_MS),
    };
    // dirujuk baris foto failed (berkas asli untuk retry)
    await insertDraftStmt(env.DB, {
      id: 'p-ref',
      createdBy: W,
      now: NOW,
      mime: 'image/png',
      width: 64,
      height: 48,
      size: 3,
      stagedName: names.referenced,
    }).run();
    await env.DB.batch(claim('p-ref'));
    await setProofState(env.DB, 'p-ref', { state: 'failed', now: NOW, lastError: 'x' }).run();
    // dirujuk state.stamped job aktif
    await seedDraft('p-job', await gradientPng());
    const jobId = await queue('p-job');
    await env.DB.prepare("UPDATE jobs SET state = ?, status = 'running' WHERE id = ?")
      .bind(JSON.stringify({ stamped: names.stamped }), jobId)
      .run();
    return names;
  }

  test('membuang yatim tua dan .partial tua; menjaga yang muda, yang dirujuk, dan nama asing', async () => {
    const names = await plantAll();
    expect(await sweepOrphanProofFiles(env)).toBe(2);
    expect(await exists(names.orphanOld)).toBe(false);
    expect(await exists(names.partialOld)).toBe(false);
    for (const kept of [
      'orphanYoung',
      'referenced',
      'stamped',
      'partialYoung',
      'stranger',
    ] as const) {
      expect([kept, await exists(names[kept])]).toEqual([kept, true]);
    }
  });

  test('folder belum ada atau tanpa PROOF_STORE = 0', async () => {
    await removeTempDir(dir);
    expect(await sweepOrphanProofFiles(env)).toBe(0);
    env.PROOF_STORE = undefined;
    expect(await sweepOrphanProofFiles(env)).toBe(0);
  });

  test('schedulerTick (startScheduler) memanggil sweepProofDrafts DAN penyapu yatim', async () => {
    const names = await plantAll();
    // draft lama yang harus disapu penyapu draft
    const staleStaged = await seedDraft('p-stale', await gradientPng());
    await env.DB.prepare('UPDATE serial_proof_photos SET updated_at = ? WHERE id = ?')
      .bind('2026-01-01T00:00:00.000Z', 'p-stale')
      .run();
    const stop = startScheduler(env, { intervalMs: 3_600_000 });
    try {
      const start = Date.now();
      for (;;) {
        const draftGone = (await findProof(env.DB, 'p-stale')) === null;
        if (draftGone && !(await exists(names.orphanOld))) break;
        if (Date.now() - start > 15_000) throw new Error('penjadwal tidak menyapu');
        await Bun.sleep(20);
      }
    } finally {
      await stop();
    }
    expect(await exists(staleStaged)).toBe(false);
    expect(await exists(names.partialOld)).toBe(false);
    expect(await exists(names.referenced)).toBe(true);
  });
});

describe('M2: penjaga klaim foto pada serials.act', () => {
  test('foto disapu di sela validasi dan komit: pesan foto yang benar, bukan 412 usang', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: 'AB12',
      stickers: [
        { stickerId: 's1', qty: 1 },
        { stickerId: 's2', qty: 1 },
      ],
    });
    await seedDraft('p1', await gradientPng());
    const original = env.DB.batch.bind(env.DB);
    env.DB.batch = async (statements) => {
      // seolah penyapu menghapus foto setelah validasi dan sebelum komit
      env.DB.batch = original;
      await env.DB.prepare('DELETE FROM serial_proof_photos WHERE id = ?').bind('p1').run();
      return original(statements);
    };
    let out: CallOut;
    try {
      out = await call(W, 'serials.act', {
        id: 'sn1',
        expectedUpdatedAt: (await rows('SELECT updated_at FROM serials WHERE id = ?', 'sn1'))[0]
          .updated_at,
        action: 'recheck',
        occurredOn: '2026-11-20',
        message: '',
        stickerIds: ['s1'],
        proofPhotoIds: ['p1'],
      });
    } finally {
      env.DB.batch = original;
    }
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('VALIDATION');
    expect(JSON.stringify(out.error)).toContain('Foto sudah kedaluwarsa, unggah ulang');
    expect(await rows("SELECT id FROM serial_events WHERE type LIKE 'recheck%'")).toHaveLength(0);
  });
});

describe('M3: canManage pada DTO', () => {
  test('pelaku dan pemegang serial: manage = true; pembaca dan editor lain = false', async () => {
    await seedDraft('p1', await gradientPng());
    const saved = await call(W, 'serials.saveBatch', {
      rows: [
        {
          clientId: 'client-000001',
          serial: 'SN-CM',
          itemId: 'i-a1',
          buId: 'bu-a',
          testDate: '2026-11-20',
          locationId: 'loc-sby',
          sample: false,
          note: '',
          proofPhotoIds: ['p1'],
        },
      ],
    });
    const serialId = saved.data.results[0].id as string;
    const expected: [string, boolean][] = [
      [W, true],
      [MANAGER, true],
      [VIEWER, false],
      [OTHER, false],
    ];
    for (const [email, can] of expected) {
      const detail = await call(email, 'serials.get', { id: serialId });
      const photo = detail.data.events.find((e: Json) => e.type === 'recorded').proofPhotos[0];
      expect([email, photo.canManage]).toEqual([email, can]);
      const history = await call(email, 'serials.history', { id: serialId });
      const fromHistory = history.data.events.find((e: Json) => e.type === 'recorded')
        .proofPhotos[0];
      expect([email, fromHistory.canManage]).toEqual([email, can]);
    }
  });

  test('unggah mengembalikan canManage = true bagi pengunggah', async () => {
    const up = await call(W, 'serialProofs.upload', {
      mime: 'image/png',
      bytes: await gradientPng(),
      width: 64,
      height: 48,
    });
    expect(up.data.canManage).toBe(true);
  });
});
