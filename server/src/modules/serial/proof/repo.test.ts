import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { isGuardFailure } from '@server/core/cas';
import { loadMigrations } from '@server/core/migrate';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  claimDraftStmts,
  countDraftsOf,
  deleteProofStmt,
  findProof,
  insertDraftStmt,
  listProofsByEvents,
  listStaleDrafts,
  setProofState,
} from './repo';

setDefaultTimeout(60_000);

let env: TestEnv;
const NOW = '2026-11-20T03:00:00.000Z';
const ALICE = 'alice@x.com';
const BOB = 'bob@x.com';

beforeEach(async () => {
  env = await createTestEnv();
});

async function draft(id: string, owner = ALICE, now = NOW): Promise<void> {
  await insertDraftStmt(env.DB, {
    id,
    createdBy: owner,
    now,
    mime: 'image/jpeg',
    width: 640,
    height: 480,
    size: 1234,
    stagedName: `staged-${id}`,
  }).run();
}

function claim(ids: string[], email = ALICE, eventId = 'ev1') {
  return claimDraftStmts(env.DB, {
    ids,
    email,
    serialId: 'sn1',
    eventId,
    snapshotJson: '{"serial":"AAA1"}',
    now: NOW,
  });
}

describe('migrasi 0019', () => {
  test('idempoten: dijalankan ulang tanpa galat dan tanpa mengubah baris', async () => {
    await draft('p1');
    const sql = (await loadMigrations()).find((m) => m.name === '0019_bukti_foto_qc.sql')?.sql;
    expect(sql).toContain('serial_proof_photos');
    await env.DB.exec(sql ?? '');
    await env.DB.exec(sql ?? '');
    expect(await countDraftsOf(env.DB, ALICE)).toBe(1);
  });

  test('CHECK menolak status di luar daftar', async () => {
    await draft('p1');
    await expect(
      env.DB.prepare("UPDATE serial_proof_photos SET state = 'aneh' WHERE id = 'p1'").run(),
    ).rejects.toThrow();
  });
});

describe('draft', () => {
  test('insertDraftStmt, findProof, countDraftsOf', async () => {
    await draft('p1');
    await draft('p2');
    await draft('p3', BOB);
    expect(await countDraftsOf(env.DB, ALICE)).toBe(2);
    expect(await countDraftsOf(env.DB, BOB)).toBe(1);
    const row = await findProof(env.DB, 'p1');
    expect(row).toMatchObject({
      id: 'p1',
      state: 'draft',
      createdBy: ALICE,
      mime: 'image/jpeg',
      width: 640,
      height: 480,
      size: 1234,
      stagedName: 'staged-p1',
      serialId: '',
      eventId: '',
      fileId: '',
      attempts: 0,
      lastError: '',
    });
    expect(await findProof(env.DB, 'tidak-ada')).toBeNull();
  });

  test('deleteProofStmt menghapus baris', async () => {
    await draft('p1');
    await deleteProofStmt(env.DB, 'p1').run();
    expect(await findProof(env.DB, 'p1')).toBeNull();
  });

  test('listStaleDrafts hanya draft yang lebih tua dari batas', async () => {
    await draft('lama', ALICE, '2026-11-01T00:00:00.000Z');
    await draft('baru', ALICE, '2026-11-19T00:00:00.000Z');
    await draft('antre', ALICE, '2026-11-01T00:00:00.000Z');
    await env.DB.batch(claim(['antre']));
    const stale = await listStaleDrafts(env.DB, '2026-11-13T00:00:00.000Z');
    expect(stale).toEqual([{ id: 'lama', stagedName: 'staged-lama' }]);
  });
});

describe('claimDraftStmts', () => {
  test('mengklaim foto draft milik sendiri menjadi queued beserta serial, kejadian, dan snapshot', async () => {
    await draft('p1');
    await draft('p2');
    await env.DB.batch(claim(['p1', 'p2']));
    for (const id of ['p1', 'p2']) {
      expect(await findProof(env.DB, id)).toMatchObject({
        state: 'queued',
        serialId: 'sn1',
        eventId: 'ev1',
        snapshotJson: '{"serial":"AAA1"}',
      });
    }
    expect(await countDraftsOf(env.DB, ALICE)).toBe(0);
  });

  test('daftar kosong = tanpa pernyataan', () => {
    expect(claim([])).toEqual([]);
  });

  test('menolak foto milik orang lain dan membatalkan seluruh batch', async () => {
    await draft('p1');
    await draft('p2', BOB);
    const error = await env.DB.batch(claim(['p1', 'p2'])).catch((e: unknown) => e);
    expect(isGuardFailure(error)).toBe(true);
    expect((await findProof(env.DB, 'p1'))?.state).toBe('draft');
    expect((await findProof(env.DB, 'p2'))?.state).toBe('draft');
  });

  test('menolak foto yang bukan draft (sudah diklaim kejadian lain)', async () => {
    await draft('p1');
    await env.DB.batch(claim(['p1'], ALICE, 'ev1'));
    const error = await env.DB.batch(claim(['p1'], ALICE, 'ev2')).catch((e: unknown) => e);
    expect(isGuardFailure(error)).toBe(true);
    expect((await findProof(env.DB, 'p1'))?.eventId).toBe('ev1');
  });

  test('menolak id yang tak ada dan id ganda', async () => {
    await draft('p1');
    const missing = await env.DB.batch(claim(['p1', 'hantu'])).catch((e: unknown) => e);
    expect(isGuardFailure(missing)).toBe(true);
    const twice = await env.DB.batch(claim(['p1', 'p1'])).catch((e: unknown) => e);
    expect(isGuardFailure(twice)).toBe(true);
    expect((await findProof(env.DB, 'p1'))?.state).toBe('draft');
  });

  test('dua klaim serentak atas foto yang sama: tepat satu menang', async () => {
    await draft('p1');
    const outcome = (eventId: string) =>
      env.DB.batch(claim(['p1'], ALICE, eventId)).then(
        () => 'ok',
        (e: unknown) => (isGuardFailure(e) ? 'gagal' : String(e)),
      );
    const results = await Promise.all([outcome('ev1'), outcome('ev2')]);
    expect(results.sort()).toEqual(['gagal', 'ok']);
  });
});

describe('setProofState', () => {
  test('mengubah status dan kolom hasil; expectState bertindak sebagai CAS', async () => {
    await draft('p1');
    await setProofState(env.DB, 'p1', {
      state: 'failed',
      now: NOW,
      attempts: 3,
      lastError: 'rusak',
    }).run();
    expect(await findProof(env.DB, 'p1')).toMatchObject({
      state: 'failed',
      attempts: 3,
      lastError: 'rusak',
    });
    const miss = await setProofState(env.DB, 'p1', {
      state: 'done',
      expectState: 'processing',
      now: NOW,
    }).run();
    expect(miss.meta.changes).toBe(0);
    const hit = await setProofState(env.DB, 'p1', {
      state: 'queued',
      expectState: 'failed',
      now: NOW,
      lastError: '',
      fileId: 'f1',
      stagedName: 'baru',
      mime: 'image/webp',
      width: 10,
      height: 20,
      size: 30,
    }).run();
    expect(hit.meta.changes).toBe(1);
    expect(await findProof(env.DB, 'p1')).toMatchObject({
      state: 'queued',
      fileId: 'f1',
      stagedName: 'baru',
      mime: 'image/webp',
      width: 10,
      height: 20,
      size: 30,
    });
  });
});

describe('listProofsByEvents', () => {
  test('memetakan baris ke DTO tanpa staged_name dan snapshot_json, dikelompokkan per kejadian', async () => {
    await draft('aaaaaaaa-1', ALICE, '2026-11-20T03:00:00.000Z');
    await draft('bbbbbbbb-2', ALICE, '2026-11-20T03:00:01.000Z');
    await draft('cccccccc-3');
    await env.DB.batch(claim(['aaaaaaaa-1', 'bbbbbbbb-2'], ALICE, 'ev1'));
    await env.DB.batch(claim(['cccccccc-3'], ALICE, 'ev2'));
    await setProofState(env.DB, 'bbbbbbbb-2', {
      state: 'failed',
      now: NOW,
      lastError: 'Berkas rusak',
    }).run();
    const map = await listProofsByEvents(env.DB, ['ev1', 'ev2', 'ev3']);
    expect([...map.keys()].sort()).toEqual(['ev1', 'ev2']);
    expect(map.get('ev1')).toEqual([
      {
        id: 'aaaaaaaa-1',
        state: 'queued',
        mime: 'image/jpeg',
        size: 1234,
        width: 640,
        height: 480,
        filename: 'bukti-aaaaaaaa.jpg',
        error: null,
      },
      {
        id: 'bbbbbbbb-2',
        state: 'failed',
        mime: 'image/jpeg',
        size: 1234,
        width: 640,
        height: 480,
        filename: 'bukti-bbbbbbbb.jpg',
        error: 'Berkas rusak',
      },
    ]);
    const serialized = JSON.stringify([...map.values()]);
    expect(serialized).not.toContain('staged');
    expect(serialized).not.toContain('snapshot');
    expect((await listProofsByEvents(env.DB, [])).size).toBe(0);
  });
});
