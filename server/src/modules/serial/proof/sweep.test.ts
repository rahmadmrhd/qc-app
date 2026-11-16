import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SERIAL_PROOF_LIMITS } from '@shared/serials';
import { claimDraftStmts, findProof, insertDraftStmt, setProofState } from './repo';
import { newStagedName } from './store';
import { sweepProofDrafts } from './sweep';

// Penyapu foto bukti `draft` yang tak pernah disimpan.

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;

let env: TestEnv;
const W = SERIAL_USERS.writer;
const NOW = '2026-11-20T03:00:00.000Z';
const DAY = 86_400_000;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse(NOW));
  await seedSerialWorld(env);
});

/** Foto `draft` dengan berkas sementara, terakhir berubah `ageDays` hari sebelum `NOW`. */
async function draft(id: string, ageDays: number): Promise<string> {
  const stagedName = newStagedName();
  await env.PROOF_STORE?.write(stagedName, new Uint8Array([1, 2, 3, 4]));
  const at = new Date(Date.parse(NOW) - ageDays * DAY).toISOString();
  await insertDraftStmt(env.DB, {
    id,
    createdBy: W,
    now: at,
    mime: 'image/png',
    width: 64,
    height: 48,
    size: 4,
    stagedName,
  }).run();
  return stagedName;
}

async function setState(id: string, state: 'queued' | 'processing' | 'done' | 'failed') {
  await env.DB.batch([
    ...claimDraftStmts(env.DB, {
      ids: [id],
      email: W,
      serialId: 'sn-a',
      eventId: `ev-${id}`,
      snapshotJson: '{}',
      now: NOW,
    }),
  ]);
  if (state !== 'queued') await setProofState(env.DB, id, { state, now: NOW }).run();
}

async function exists(id: string): Promise<boolean> {
  return (await findProof(env.DB, id)) !== null;
}

describe('sweepProofDrafts', () => {
  test('membuang draft lebih tua dari batas hari beserta berkasnya; yang lebih muda tetap', async () => {
    const limit = SERIAL_PROOF_LIMITS.draftSweepDays;
    const oldName = await draft('p-old', limit + 1);
    const youngName = await draft('p-young', limit - 1);
    expect(await sweepProofDrafts(env)).toBe(1);
    expect(await exists('p-old')).toBe(false);
    expect(await exists('p-young')).toBe(true);
    expect(await env.PROOF_STORE?.read(oldName)).toBeNull();
    expect(await env.PROOF_STORE?.read(youngName)).not.toBeNull();
  });

  test('queued, processing, failed, dan done tidak pernah disapu walau sangat tua', async () => {
    for (const state of ['queued', 'processing', 'failed', 'done'] as const) {
      const id = `p-${state}`;
      await draft(id, 60);
      await setState(id, state);
      // `updated_at` dikembalikan ke masa lampau jauh agar hanya status yang melindunginya
      await env.DB.prepare('UPDATE serial_proof_photos SET updated_at = ? WHERE id = ?')
        .bind('2026-01-01T00:00:00.000Z', id)
        .run();
    }
    expect(await sweepProofDrafts(env)).toBe(0);
    for (const state of ['queued', 'processing', 'failed', 'done']) {
      expect(await exists(`p-${state}`)).toBe(true);
    }
  });

  test('berkas sementara sudah hilang: baris tetap disapu tanpa galat; tanpa draft = 0', async () => {
    expect(await sweepProofDrafts(env)).toBe(0);
    const name = await draft('p-nofile', 30);
    await env.PROOF_STORE?.remove(name);
    expect(await sweepProofDrafts(env)).toBe(1);
    expect(await exists('p-nofile')).toBe(false);
  });

  test('foto yang keburu diklaim Simpan di antara pemilihan dan penghapusan tidak ikut hilang', async () => {
    const name = await draft('p-race', 30);
    // Simpan mengklaimnya (queued) tepat sesudah sapuan memilih dan sebelum menghapus: dua operasi dijalankan
    // berurutan di sini dengan klaim lebih dulu; penghapusan bersyarat `state = 'draft'` harus tak mengenainya.
    await env.DB.batch(
      claimDraftStmts(env.DB, {
        ids: ['p-race'],
        email: W,
        serialId: 'sn-a',
        eventId: 'ev-race',
        snapshotJson: '{}',
        now: NOW,
      }),
    );
    await env.DB.prepare('UPDATE serial_proof_photos SET updated_at = ? WHERE id = ?')
      .bind('2026-01-01T00:00:00.000Z', 'p-race')
      .run();
    expect(await sweepProofDrafts(env)).toBe(0);
    expect((await findProof(env.DB, 'p-race'))?.state).toBe('queued');
    expect(await env.PROOF_STORE?.read(name)).not.toBeNull();
  });

  test('draft disapu lalu Simpan merujuknya: ditolak bersih (kedaluwarsa), tanpa serial dan tanpa job', async () => {
    await draft('p-gone', SERIAL_PROOF_LIMITS.draftSweepDays + 2);
    expect(await sweepProofDrafts(env)).toBe(1);
    const out = (await restCall(env, W, 'serials.saveBatch', {
      rows: [
        {
          clientId: 'client-000001',
          serial: 'SN-SWEPT',
          itemId: 'i-a1',
          buId: 'bu-a',
          testDate: '2026-11-20',
          locationId: 'loc-sby',
          sample: false,
          note: '',
          proofPhotoIds: ['p-gone'],
        },
      ],
    })) as { ok: boolean; data: Json };
    expect(out.ok).toBe(true);
    expect(out.data.results[0]).toMatchObject({
      result: 'invalid',
      message: 'Foto sudah kedaluwarsa, unggah ulang',
    });
    const serials = await env.DB.prepare("SELECT id FROM serials WHERE serial = 'SN-SWEPT'").all();
    expect(serials.results).toHaveLength(0);
    const jobs = await env.DB.prepare("SELECT id FROM jobs WHERE kind = 'serial_proof'").all();
    expect(jobs.results).toHaveLength(0);
  });
});
