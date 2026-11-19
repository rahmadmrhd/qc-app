// `serials.saveBatch` setelah alur laporan rusak (2026-11-14): hanya baris `good` yang tersimpan; yang bermasalah lewat
// Lapor Rusak. Juga `source` dan idempotensi `clientId`.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { insertDraftStmt } from './proof/repo';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedSerialWorld(env);
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, '')",
  ).run();
});

let counter = 0;
const cid = () => `client-${String(++counter).padStart(6, '0')}`;

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: cid(),
    serial: `SN-${counter + 1}`,
    itemId: 'i-a1',
    buId: 'bu-a',
    testDate: '2026-11-12',
    locationId: 'loc-sby',
    sample: false,
    note: '',
    ...over,
  };
}

const save = (email: string, rows: Record<string, unknown>[]) =>
  call(email, 'serials.saveBatch', { rows });

async function stock(stickerId: string): Promise<number> {
  const found = await env.DB.prepare(
    "SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = 'loc-sby'",
  )
    .bind(stickerId)
    .first<{ qty: number | string }>();
  return Number(found?.qty);
}

const casesOf = async () =>
  (
    await env.DB.prepare(
      'SELECT id, number, serial_id, opened_on FROM serial_cases ORDER BY number',
    ).all<{
      id: string;
      number: string;
      serial_id: string;
      opened_on: string;
    }>()
  ).results;

describe('baris saveBatch hanya good', () => {
  test('status failed, reported, broken atau status tak dikenal: invalid, tanpa serial, laporan, atau pemotongan stok', async () => {
    const out = await save(W, [
      row({ serial: 'B1', status: 'failed', damage: 'Layar retak' }),
      row({ serial: 'B2', status: 'reported' }),
      row({ serial: 'B3', status: 'broken' }),
      row({ serial: 'B4', status: 'lain' }),
    ]);
    expect(out.data.results.map((r: Json) => r.result)).toEqual([
      'invalid',
      'invalid',
      'invalid',
      'invalid',
    ]);
    expect(out.data.results[0].message).toContain('Lapor Rusak');
    expect(await casesOf()).toEqual([]);
    expect(await stock('s1')).toBe(10);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM serials').first<{
      n: number | string;
    }>();
    expect(Number(count?.n)).toBe(0);
  });

  test('tanpa status atau status good: created berstatus good; kunci damage lama diabaikan, tanpa laporan', async () => {
    const out = await save(W, [
      row({ serial: 'G1', status: 'good', damage: 'abaikan' }),
      row({ serial: 'G2' }),
    ]);
    expect(out.data.results.map((r: Json) => r.result)).toEqual(['created', 'created']);
    const rows = await env.DB.prepare(
      'SELECT serial, status, open_case_id FROM serials ORDER BY serial',
    ).all<{ serial: string; status: string; open_case_id: string }>();
    expect(rows.results).toEqual([
      { serial: 'G1', status: 'good', open_case_id: '' },
      { serial: 'G2', status: 'good', open_case_id: '' },
    ]);
    expect(await casesOf()).toEqual([]);
    const events = await env.DB.prepare(
      "SELECT type FROM serial_events WHERE type <> 'recorded'",
    ).all<{ type: string }>();
    expect(events.results).toEqual([]);
  });

  test('kirim ulang clientId yang sama: created dengan id lama, stok tidak dipotong dua kali', async () => {
    const same = row({ serial: 'RETRY-1' });
    const first = await save(W, [same]);
    const second = await save(W, [same]);
    expect(second.data.results[0]).toMatchObject({
      result: 'created',
      id: first.data.results[0].id,
    });
    expect(await stock('s1')).toBe(9);
  });

  test('serial yang sama dicatat dua kali dengan clientId berbeda: rechecked; tanpa stiker tercentang stok tak berubah', async () => {
    await save(W, [row({ serial: 'DUP-1' })]);
    const out = await save(W, [row({ serial: 'DUP-1' })]);
    expect(out.data.results[0].result).toBe('rechecked');
    // Baris pertama memotong semua stiker yang berlaku; cek ulang (stiker tak dikirim = tak ada yang tercentang) tidak.
    expect(await stock('s1')).toBe(9);
  });

  test('serialservice: edit tidak dapat mencatat: FORBIDDEN', async () => {
    const out = await save(SERIAL_USERS.svcEdit, [row({ serial: 'SVC-1' })]);
    expect(out.error?.code).toBe('FORBIDDEN');
  });
});

describe('source', () => {
  test('countrylock dan manual tersimpan di data kejadian recorded; tanpa source tak ada kuncinya', async () => {
    const out = await save(W, [
      row({ serial: 'SRC-1', source: 'countrylock' }),
      row({ serial: 'SRC-2', source: 'manual' }),
      row({ serial: 'SRC-3' }),
    ]);
    const ids = out.data.results.map((r: Json) => r.id as string);
    const dataOf = async (id: string) =>
      JSON.parse(
        (
          await env.DB.prepare(
            "SELECT data_json FROM serial_events WHERE serial_id = ? AND type = 'recorded'",
          )
            .bind(id)
            .first<{ data_json: string }>()
        )?.data_json ?? '{}',
      );
    expect((await dataOf(ids[0])).source).toBe('countrylock');
    expect((await dataOf(ids[1])).source).toBe('manual');
    expect('source' in (await dataOf(ids[2]))).toBe(false);
  });

  test('source di luar enum: invalid', async () => {
    const out = await save(W, [row({ serial: 'SRC-9', source: 'lain' })]);
    expect(out.data.results[0].result).toBe('invalid');
  });
});

describe('item wajib foto bukti (spek 2026-11-18 D)', () => {
  const NEED = (n: number) => `Item ini wajib foto bukti minimal ${n}`;
  const setProof = (itemId: string, required: boolean, min: number) =>
    env.DB.prepare('UPDATE items SET proof_required = ?, proof_min = ? WHERE id = ?')
      .bind(required ? 1 : 0, min, itemId)
      .run();
  const draft = async (id: string): Promise<string> => {
    await insertDraftStmt(env.DB, {
      id,
      createdBy: W,
      now: '2026-11-11T00:00:00.000Z',
      mime: 'image/jpeg',
      width: 640,
      height: 480,
      size: 1000,
      stagedName: `staged-${id}`,
    }).run();
    return id;
  };
  const serialCount = async () =>
    Number(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM serials').first<{ n: number | string }>())
        ?.n,
    );

  test('0 dan 1 foto pada item min 2 = invalid bermakna; baris lain dalam batch tetap created', async () => {
    await setProof('i-a1', true, 2);
    const p1 = await draft('pf-1');
    const out = await save(W, [
      row({ serial: 'W-0' }),
      row({ serial: 'W-1', proofPhotoIds: [p1] }),
      row({ serial: 'W-OK', itemId: 'i-a2' }),
    ]);
    const results = out.data.results as Json[];
    expect(results.map((r) => r.result)).toEqual(['invalid', 'invalid', 'created']);
    expect(results[0].message).toBe(NEED(2));
    expect(results[1].message).toBe(NEED(2));
    // Pesan baru TIDAK dikenali web sebagai penolakan foto (yang mengosongkan foto baris).
    expect(results[1].message).not.toMatch(/^(Foto sudah kedaluwarsa|Ada foto yang tidak dikenal)/);
    expect(await serialCount()).toBe(1);
  });

  test('dua foto draft sah pada item min 2 = created', async () => {
    await setProof('i-a1', true, 2);
    const ids = [await draft('pf-a'), await draft('pf-b')];
    const out = await save(W, [row({ serial: 'W-2', proofPhotoIds: ids })]);
    expect(out.data.results[0].result).toBe('created');
    expect(await serialCount()).toBe(1);
  });

  test('item tak wajib foto tanpa foto tetap created', async () => {
    await setProof('i-a1', false, 3);
    const out = await save(W, [row({ serial: 'N-0' })]);
    expect(out.data.results[0].result).toBe('created');
  });

  test('kirim ulang clientId yang sama setelah sukses = idempoten, aturan tak dievaluasi ulang', async () => {
    const clientId = cid();
    const first = await save(W, [row({ clientId, serial: 'IDEM-1' })]);
    expect(first.data.results[0].result).toBe('created');
    await setProof('i-a1', true, 3);
    const again = await save(W, [row({ clientId, serial: 'IDEM-1' })]);
    expect(again.data.results[0]).toMatchObject({
      result: 'created',
      id: first.data.results[0].id,
    });
    expect(await serialCount()).toBe(1);
  });

  test('bendera item diubah di antara dua permintaan: permintaan kedua memakai nilai terbaru', async () => {
    await setProof('i-a1', true, 1);
    const p1 = await draft('pf-c');
    const ok = await save(W, [row({ serial: 'CHG-1', proofPhotoIds: [p1] })]);
    expect(ok.data.results[0].result).toBe('created');
    await setProof('i-a1', true, 3);
    const p2 = await draft('pf-d');
    const next = await save(W, [row({ serial: 'CHG-2', proofPhotoIds: [p2] })]);
    expect(next.data.results[0]).toMatchObject({ result: 'invalid', message: NEED(3) });
    await setProof('i-a1', false, 1);
    const free = await save(W, [row({ serial: 'CHG-3' })]);
    expect(free.data.results[0].result).toBe('created');
  });
});
