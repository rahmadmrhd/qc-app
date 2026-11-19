import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { isGuardFailure } from '@server/core/cas';
import type { Env } from '@server/core/env';
import { seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  CASE_NUMBER_ATTEMPTS,
  closeCaseStmt,
  insertCaseStmt,
  loadCases,
  reserveCaseNumber,
  runWithCaseNumber,
  setCaseOriginStmt,
} from './case-repo';
import { insertEventStmt, insertNextEventStmt } from './repo';

setDefaultTimeout(60_000);

let env: TestEnv;
const BU = 'SBY';
const PERIOD = '2611';
const NOW = '2026-11-20T03:00:00.000Z';

beforeEach(async () => {
  env = await createTestEnv();
  await seedSerialWorld(env);
  await seedSerial(env, { id: 'sn1', serial: 'AAA1' });
  await seedSerial(env, { id: 'sn2', serial: 'AAA2' });
});

/** Membuka kasus untuk serial lewat jalur nyata: pesan nomor + INSERT dalam satu batch, dibungkus pengulang. */
async function openCase(
  serialId: string,
  caseId: string,
  e: Env = env,
  buCode = BU,
  period = PERIOD,
): Promise<string> {
  return runWithCaseNumber(
    e,
    serialId,
    null,
    async () => {
      const reservation = await reserveCaseNumber(e, buCode, period);
      await e.DB.batch([
        ...reservation.statements,
        insertCaseStmt(e.DB, {
          id: caseId,
          number: reservation.number,
          serialId,
          buId: 'bu-a',
          openedOn: '2026-11-20',
          now: NOW,
          actorEmail: 'a@x.com',
        }),
      ]);
      return reservation.number;
    },
    'stale',
  );
}

describe('nomor LP', () => {
  test('dua pembukaan kasus serentak pada (BU, bulan) yang sama mendapat nomor -0001 dan -0002', async () => {
    const [a, b] = await Promise.all([openCase('sn1', 'c1'), openCase('sn2', 'c2')]);
    expect([a, b].sort()).toEqual(['LP/SBY/2611-0001', 'LP/SBY/2611-0002']);
    const row = await env.DB.prepare('SELECT value FROM counters WHERE `key` = ?')
      .bind('lp:SBY:2611')
      .first<{ value: number }>();
    expect(Number(row?.value)).toBe(2);
  });

  test('enam pembukaan serentak: nomor unik berurutan', async () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    const numbers = await Promise.all(ids.map((id) => openCase('sn1', id)));
    expect(new Set(numbers).size).toBe(6);
    expect([...numbers].sort()).toEqual(ids.map((_, i) => `LP/SBY/2611-000${i + 1}`));
  });

  test('BU lain pada bulan yang sama dan bulan berikutnya mulai lagi dari 0001', async () => {
    expect(await openCase('sn1', 'c1')).toBe('LP/SBY/2611-0001');
    expect(await openCase('sn2', 'c2')).toBe('LP/SBY/2611-0002');
    expect((await reserveCaseNumber(env, 'JKT', PERIOD)).number).toBe('LP/JKT/2611-0001');
    expect((await reserveCaseNumber(env, BU, '2612')).number).toBe('LP/SBY/2612-0001');
  });

  test('tanpa baris counters mulai dari nomor tertinggi yang ada pada (BU, bulan) itu saja', async () => {
    const insert = (id: string, number: string, openedOn: string) =>
      insertCaseStmt(env.DB, {
        id,
        number,
        serialId: 'sn1',
        buId: 'bu-a',
        openedOn,
        now: NOW,
        actorEmail: 'a@x.com',
      });
    await env.DB.batch([
      insert('x1', 'LP/SBY/2611-0007', '2026-11-20'),
      insert('x2', 'LP/SBY/2612-0050', '2026-12-01'),
      insert('x3', 'LP/JKT/2611-0090', '2026-11-20'),
      // Nomor format lama tak memengaruhi urutan baru.
      insert('x4', 'LP-20261118-003', '2026-11-18'),
    ]);
    expect((await reserveCaseNumber(env, BU, PERIOD)).number).toBe('LP/SBY/2611-0008');
    expect((await reserveCaseNumber(env, BU, '2701')).number).toBe('LP/SBY/2701-0001');
    expect((await reserveCaseNumber(env, 'BDG', PERIOD)).number).toBe('LP/BDG/2611-0001');
  });

  test('kode BU ber-angka dan tanda hubung tidak berbagi rentang dengan kode awalan yang sama', async () => {
    const insert = (id: string, number: string) =>
      insertCaseStmt(env.DB, {
        id,
        number,
        serialId: 'sn1',
        buId: 'bu-a',
        openedOn: '2026-11-20',
        now: NOW,
        actorEmail: 'a@x.com',
      });
    await env.DB.batch([
      insert('u1', 'LP/UM-1/2611-0004'),
      insert('u2', 'LP/UM/2611-0020'),
      insert('u3', 'LP/UM-10/2611-0099'),
    ]);
    expect((await reserveCaseNumber(env, 'UM-1', PERIOD)).number).toBe('LP/UM-1/2611-0005');
    expect((await reserveCaseNumber(env, 'UM', PERIOD)).number).toBe('LP/UM/2611-0021');
    expect((await reserveCaseNumber(env, 'UM-10', PERIOD)).number).toBe('LP/UM-10/2611-0100');
  });

  test('urutan di atas 9999 memanjang dan dilanjutkan dari nomor tertinggi', async () => {
    await env.DB.batch([
      insertCaseStmt(env.DB, {
        id: 'big',
        number: 'LP/SBY/2611-9999',
        serialId: 'sn1',
        buId: 'bu-a',
        openedOn: '2026-11-20',
        now: NOW,
        actorEmail: 'a@x.com',
      }),
    ]);
    expect((await reserveCaseNumber(env, BU, PERIOD)).number).toBe('LP/SBY/2611-10000');
  });

  test('batch dengan penghitung usang dibatalkan seluruhnya (tak ada kasus yatim)', async () => {
    const stale = await reserveCaseNumber(env, BU, PERIOD);
    await openCase('sn1', 'c1');
    const error = await env.DB.batch([
      ...stale.statements,
      insertCaseStmt(env.DB, {
        id: 'c-stale',
        number: stale.number,
        serialId: 'sn2',
        buId: 'bu-a',
        openedOn: '2026-11-20',
        now: NOW,
        actorEmail: 'a@x.com',
      }),
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((await loadCases(env.DB, 'sn2')).length).toBe(0);
  });

  test('batas percobaan dilaporkan sebagai stale', async () => {
    let calls = 0;
    const error = await runWithCaseNumber(
      env,
      'sn1',
      null,
      async () => {
        calls++;
        // Galat penjaga mentah (out_of_range) = rebutan penghitung.
        await env.DB.prepare('SELECT (-9223372036854775807 - 2) AS x').first();
        return 'tak-tercapai';
      },
      'basi',
    ).catch((e: unknown) => e);
    expect(calls).toBe(CASE_NUMBER_ATTEMPTS);
    expect((error as { stale?: boolean }).stale).toBe(true);
  });
});

describe('runWithCaseNumber: serial berubah = stale, penghitung saja = ulangi', () => {
  test('updated_at serial berubah di tengah: stale tanpa mengulangi', async () => {
    let calls = 0;
    const error = await runWithCaseNumber(
      env,
      'sn1',
      '2026-11-12T00:00:00.000Z',
      async () => {
        calls++;
        await env.DB.prepare(
          "UPDATE serials SET updated_at = '2026-11-13T00:00:00.000Z' WHERE id = 'sn1'",
        ).run();
        await env.DB.prepare('SELECT (-9223372036854775807 - 2) AS x').first();
        return 'x';
      },
      'basi',
    ).catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect((error as { stale?: boolean }).stale).toBe(true);
    expect((error as Error).message).toBe('basi');
  });

  test('updated_at serial sama: diulang sampai sukses', async () => {
    let calls = 0;
    const result = await runWithCaseNumber(
      env,
      'sn1',
      '2026-11-12T00:00:00.000Z',
      async () => {
        calls++;
        if (calls < 3) await env.DB.prepare('SELECT (-9223372036854775807 - 2) AS x').first();
        return 'ok';
      },
      'basi',
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  test('galat non-penjaga diteruskan tanpa mengulang', async () => {
    let calls = 0;
    const error = await runWithCaseNumber(
      env,
      'sn1',
      null,
      async () => {
        calls++;
        throw new Error('lain');
      },
      'basi',
    ).catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect((error as Error).message).toBe('lain');
  });
});

describe('pernyataan kasus', () => {
  test('closeCaseStmt kedua kalinya membatalkan batch (penjaga), kasus tetap tertutup oleh yang pertama', async () => {
    await openCase('sn1', 'c1');
    await env.DB.batch([closeCaseStmt(env.DB, 'c1', 'good', '2026-11-21', NOW)]);
    const error = await env.DB.batch([
      closeCaseStmt(env.DB, 'c1', 'broken', '2026-11-22', NOW),
    ]).catch((e: unknown) => e);
    expect(isGuardFailure(error)).toBe(true);
    const [row] = await loadCases(env.DB, 'sn1');
    expect(row).toMatchObject({ closed_on: '2026-11-21', outcome: 'good' });
  });

  test('setCaseOriginStmt mengisi lokasi QC asal; loadCases terbaru dulu', async () => {
    await openCase('sn1', 'c1');
    env.clock.set(Date.parse('2026-11-21T00:00:00.000Z'));
    await env.DB.batch([
      insertCaseStmt(env.DB, {
        id: 'c2',
        number: 'LP/SBY/2611-9001',
        serialId: 'sn1',
        buId: 'bu-a',
        openedOn: '2026-11-21',
        now: '2026-11-21T03:00:00.000Z',
        actorEmail: 'a@x.com',
      }),
      setCaseOriginStmt(env.DB, 'c1', 'loc-sby', NOW),
    ]);
    const cases = await loadCases(env.DB, 'sn1');
    expect(cases.map((c) => [c.id, c.origin_location_id])).toEqual([
      ['c2', ''],
      ['c1', 'loc-sby'],
    ]);
  });
});

describe('kejadian membawa case_id', () => {
  const base = {
    serialId: 'sn1',
    occurredOn: '2026-11-20',
    now: NOW,
    actorId: 'u',
    actorName: 'U',
    actorTeam: 'qc' as const,
    message: '',
    changes: [],
    data: {},
  };

  test('insertNextEventStmt dan insertEventStmt menulis case_id; tanpa kasus tetap kosong', async () => {
    await env.DB.batch([
      insertNextEventStmt(env.DB, { ...base, id: 'e-case', caseId: 'c1', type: 'report_failure' }),
    ]);
    await env.DB.batch([
      insertNextEventStmt(env.DB, { ...base, id: 'e-none', caseId: '', type: 'note' }),
    ]);
    await env.DB.batch([
      insertEventStmt(env.DB, {
        ...base,
        serialId: 'sn2',
        id: 'e-first',
        caseId: 'c9',
        seq: 5,
        type: 'recorded',
      }),
    ]);
    const rows = await env.DB.prepare(
      "SELECT id, case_id, seq FROM serial_events WHERE id IN ('e-case', 'e-none', 'e-first', 'sn1-e1') ORDER BY id",
    ).all<{ id: string; case_id: string; seq: number }>();
    expect(rows.results.map((r) => [r.id, r.case_id, Number(r.seq)])).toEqual([
      ['e-case', 'c1', 2],
      ['e-first', 'c9', 5],
      ['e-none', '', 3],
      ['sn1-e1', '', 1],
    ]);
  });
});
