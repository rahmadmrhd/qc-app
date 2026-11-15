import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { findProof, insertDraftStmt, setProofState } from './repo';

// Foto bukti QC ditautkan saat Simpan (Tambah dan Cek ulang): klaim ber-CAS + job di batch yang sama dengan kejadian.

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const W = SERIAL_USERS.writer;
const OTHER = SERIAL_USERS.both;
const VIEWER = SERIAL_USERS.viewer;
const AT = '2026-11-12T00:00:00.000Z';
const TODAY = '2026-11-12';
const SAVED_AT = '2026-11-12T03:00:00.000Z';
const UNKNOWN = 'Ada foto yang tidak dikenal atau sudah dipakai';
const EXPIRED = 'Foto sudah kedaluwarsa, unggah ulang';

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse(SAVED_AT));
  await seedSerialWorld(env);
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, ''), ('s1', 'loc-jkt', 10, ''), ('s2', 'loc-jkt', 10, '')",
  ).run();
});

let counter = 0;
const cid = () => `client-${String(++counter).padStart(6, '0')}`;

async function draft(id: string, owner: string = W): Promise<string> {
  await insertDraftStmt(env.DB, {
    id,
    createdBy: owner,
    now: '2026-11-11T00:00:00.000Z',
    mime: 'image/jpeg',
    width: 640,
    height: 480,
    size: 1000,
    stagedName: `staged-${id}`,
  }).run();
  return id;
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: cid(),
    serial: `SN-${counter + 1}`,
    itemId: 'i-a1',
    buId: 'bu-a',
    testDate: TODAY,
    locationId: 'loc-sby',
    sample: false,
    note: '',
    ...over,
  };
}

const save = (rows: Record<string, unknown>[], email: string = W) =>
  call(email, 'serials.saveBatch', { rows });

const rows = async (sql: string, ...binds: unknown[]): Promise<Json[]> =>
  (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;

const proofJobs = () =>
  rows("SELECT status, input FROM jobs WHERE kind = 'serial_proof' ORDER BY input");
const serialCount = async () => (await rows('SELECT id FROM serials')).length;

const act = (
  action: string,
  extra: Record<string, unknown> = {},
  options: { email?: string; id?: string; at?: string } = {},
) =>
  call(options.email ?? W, 'serials.act', {
    id: options.id ?? 'sn1',
    expectedUpdatedAt: options.at ?? AT,
    action,
    occurredOn: TODAY,
    message: '',
    ...extra,
  });

const seedOne = (over: Record<string, unknown> = {}) =>
  seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    stickers: [
      { stickerId: 's1', qty: 1 },
      { stickerId: 's2', qty: 1 },
    ],
    ...over,
  });
const seedReported = (over: Record<string, unknown> = {}) =>
  seedOne({ status: 'reported', openCase: { id: 'case-1', number: 'LP-20261110-001' }, ...over });
const seedRecheckTransit = (over: Record<string, unknown> = {}) =>
  seedSerial(env, {
    id: 'sn1',
    serial: 'AB12',
    status: 'recheck',
    custody: 'transit',
    locationId: 'loc-jkt',
    stickers: [{ stickerId: 's1', qty: 1 }],
    transitFromLocationId: 'loc-jkt',
    transitToLocationId: 'loc-sby',
    transitOn: '2026-11-10',
    openCase: { id: 'case-1', number: 'LP-20261110-001', originLocationId: 'loc-sby' },
    ...over,
  });

const eventOf = async (type: string, serialId = 'sn1') =>
  (
    await rows(
      'SELECT id, type FROM serial_events WHERE serial_id = ? AND type = ?',
      serialId,
      type,
    )
  )[0];

describe('Tambah Serial Number dengan foto', () => {
  test('dua foto: keduanya queued, menaut ke kejadian recorded, snapshot beku, dan dua job dipasang', async () => {
    const [p1, p2] = [await draft('p1'), await draft('p2')];
    const out = await save([row({ serial: 'SN-FOTO', proofPhotoIds: [p1, p2] })]);
    expect(out.data.results[0]).toMatchObject({ result: 'created' });
    const serialId = out.data.results[0].id as string;
    const event = await eventOf('recorded', serialId);
    for (const id of [p1, p2]) {
      const proof = await findProof(env.DB, id);
      expect(proof).toMatchObject({ state: 'queued', eventId: event.id, serialId });
      expect(JSON.parse(proof?.snapshotJson ?? '{}')).toEqual({
        serial: 'SN-FOTO',
        brand: 'Merk',
        model: 'Alfa',
        buCode: 'A',
        locationName: 'Surabaya',
        actorName: expect.any(String),
        actorTeam: 'qc',
        savedAt: SAVED_AT,
      });
    }
    expect(await proofJobs()).toEqual([
      { status: 'queued', input: JSON.stringify({ photoId: 'p1' }) },
      { status: 'queued', input: JSON.stringify({ photoId: 'p2' }) },
    ]);
  });

  test('tanpa foto: perilaku lama (tanpa job, tanpa foto)', async () => {
    const out = await save([row()]);
    expect(out.data.results[0].result).toBe('created');
    expect(await proofJobs()).toEqual([]);
  });

  test('jam cap = waktu server saat Simpan, bukan saat foto diunggah atau job berjalan', async () => {
    await draft('p1');
    env.clock.set(Date.parse('2026-11-12T05:30:00.000Z'));
    await save([row({ proofPhotoIds: ['p1'] })]);
    const proof = await findProof(env.DB, 'p1');
    expect(JSON.parse(proof?.snapshotJson ?? '{}').savedAt).toBe('2026-11-12T05:30:00.000Z');
  });

  test('simpan ulang dengan clientId sama tidak menaut dua kali dan tidak memasang job lagi', async () => {
    await draft('p1');
    const clientId = cid();
    const first = await save([row({ clientId, serial: 'SN-X', proofPhotoIds: ['p1'] })]);
    const again = await save([row({ clientId, serial: 'SN-X', proofPhotoIds: ['p1'] })]);
    expect(again.data.results[0]).toMatchObject({
      result: 'created',
      id: first.data.results[0].id,
    });
    expect(await serialCount()).toBe(1);
    expect(await proofJobs()).toHaveLength(1);
    expect((await findProof(env.DB, 'p1'))?.state).toBe('queued');
  });

  test('foto orang lain, sudah dipakai, ganda, atau tak dikenal: baris ditolak dan tidak ada entri tersimpan', async () => {
    await draft('mine');
    await draft('theirs', OTHER);
    await draft('used');
    await save([row({ serial: 'SN-USED', proofPhotoIds: ['used'] })]);
    const before = await serialCount();
    const cases: [string, string[], string][] = [
      ['orang lain', ['mine', 'theirs'], UNKNOWN],
      ['sudah dipakai', ['mine', 'used'], UNKNOWN],
      ['ganda', ['mine', 'mine'], 'Daftar foto tidak valid'],
      ['tak ada (disapu)', ['mine', 'hantu'], EXPIRED],
    ];
    for (const [label, ids, message] of cases) {
      const out = await save([row({ proofPhotoIds: ids })]);
      expect([label, out.data.results[0].result]).toEqual([label, 'invalid']);
      expect([label, out.data.results[0].message]).toEqual([label, message]);
    }
    expect(await serialCount()).toBe(before);
    expect((await findProof(env.DB, 'mine'))?.state).toBe('draft');
    expect((await findProof(env.DB, 'theirs'))?.state).toBe('draft');
    expect(await proofJobs()).toHaveLength(1);
  });

  test('lebih dari 5 foto atau bentuk id tak sah: baris invalid', async () => {
    const ids = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => draft(id)));
    const tooMany = await save([row({ proofPhotoIds: ids })]);
    expect(tooMany.data.results[0]).toMatchObject({
      result: 'invalid',
      message: 'Daftar foto tidak valid',
    });
    const badShape = await save([row({ proofPhotoIds: [1, 2] })]);
    expect(badShape.data.results[0].result).toBe('invalid');
    const five = await save([row({ proofPhotoIds: ids.slice(0, 5) })]);
    expect(five.data.results[0].result).toBe('created');
    expect(await serialCount()).toBe(1);
  });

  test('foto draft yang sudah disapu: pesan kedaluwarsa dan tidak ada entri tersimpan', async () => {
    await draft('p1');
    await env.DB.prepare('DELETE FROM serial_proof_photos WHERE id = ?').bind('p1').run();
    const out = await save([row({ proofPhotoIds: ['p1'] })]);
    expect(out.data.results[0]).toMatchObject({ result: 'invalid', message: EXPIRED });
    expect(await serialCount()).toBe(0);
  });

  test('dua Simpan serentak merujuk foto yang sama: tepat satu sukses, yang kalah gagal bersih', async () => {
    await draft('p1');
    const [a, b] = await Promise.all([
      save([row({ serial: 'SN-A', proofPhotoIds: ['p1'] })]),
      save([row({ serial: 'SN-B', proofPhotoIds: ['p1'] })], W),
    ]);
    const results = [a.data.results[0], b.data.results[0]];
    expect(results.filter((r: Json) => r.result === 'created')).toHaveLength(1);
    const loser = results.find((r: Json) => r.result !== 'created');
    expect(loser.result).not.toBe('created');
    expect(await serialCount()).toBe(1);
    expect(await proofJobs()).toHaveLength(1);
    expect((await findProof(env.DB, 'p1'))?.state).toBe('queued');
  });
});

describe('Cek ulang dengan foto', () => {
  test('recheck lolos menaut ke kejadian recheck; job dipasang; stiker tetap bekerja', async () => {
    await seedOne();
    await draft('p1');
    await draft('p2');
    const out = await act('recheck', { stickerIds: ['s1'], proofPhotoIds: ['p1', 'p2'] });
    expect(out.ok).toBe(true);
    const event = await eventOf('recheck');
    for (const id of ['p1', 'p2']) {
      expect(await findProof(env.DB, id)).toMatchObject({
        state: 'queued',
        eventId: event.id,
        serialId: 'sn1',
      });
    }
    expect(await proofJobs()).toHaveLength(2);
    const snapshot = JSON.parse((await findProof(env.DB, 'p1'))?.snapshotJson ?? '{}');
    expect(snapshot).toMatchObject({
      serial: 'AB12',
      brand: 'Merk',
      model: 'Alfa',
      buCode: 'A',
      locationName: 'Surabaya',
      actorTeam: 'qc',
      savedAt: SAVED_AT,
    });
  });

  test('recheck hasil gagal: foto menaut ke kejadian recheck (bukan report_failure)', async () => {
    await seedOne();
    await draft('p1');
    const out = await act('recheck', { result: 'fail', message: 'Rusak', proofPhotoIds: ['p1'] });
    expect(out.ok).toBe(true);
    const event = await eventOf('recheck');
    expect((await findProof(env.DB, 'p1'))?.eventId).toBe(event.id);
  });

  test('recheck_pass dan recheck_fail menaut foto', async () => {
    await seedReported();
    await draft('p1');
    expect((await act('recheck_fail', { message: 'Masih rusak', proofPhotoIds: ['p1'] })).ok).toBe(
      true,
    );
    expect((await findProof(env.DB, 'p1'))?.eventId).toBe((await eventOf('recheck_fail')).id);
    const updatedAt = (await rows('SELECT updated_at FROM serials WHERE id = ?', 'sn1'))[0]
      .updated_at;
    await draft('p2');
    expect(
      (await act('recheck_pass', { message: 'Normal', proofPhotoIds: ['p2'] }, { at: updatedAt }))
        .ok,
    ).toBe(true);
    expect((await findProof(env.DB, 'p2'))?.eventId).toBe((await eventOf('recheck_pass')).id);
  });

  test('cek ulang dari transit: cap memakai lokasi tujuan (lokasi sesudah kejadian)', async () => {
    await seedRecheckTransit();
    await draft('p1');
    const out = await act('recheck_pass', { message: 'Normal', proofPhotoIds: ['p1'] });
    expect(out.ok).toBe(true);
    expect(out.data.locationName).toBe('Surabaya');
    const snapshot = JSON.parse((await findProof(env.DB, 'p1'))?.snapshotJson ?? '{}');
    expect(snapshot.locationName).toBe('Surabaya');
    expect(snapshot.locationName).not.toBe('Jakarta');
  });

  test('foto bermasalah menggagalkan aksi: serial, kejadian, dan stok tidak berubah', async () => {
    await seedOne();
    await draft('theirs', OTHER);
    const out = await act('recheck', { stickerIds: ['s1'], proofPhotoIds: ['theirs'] });
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('VALIDATION');
    expect(out.error?.message).toBe(UNKNOWN);
    expect((await rows('SELECT id FROM serial_events WHERE serial_id = ?', 'sn1')).length).toBe(1);
    expect(
      (
        await rows(
          "SELECT qty FROM sticker_stock WHERE sticker_id = 's1' AND location_id = 'loc-sby'",
        )
      )[0].qty,
    ).toBe(10);
    expect((await findProof(env.DB, 'theirs'))?.state).toBe('draft');
    expect(await proofJobs()).toEqual([]);
  });

  test('foto yang sudah disapu pada aksi: pesan kedaluwarsa', async () => {
    await seedOne();
    const out = await act('recheck', { proofPhotoIds: ['hantu'] });
    expect(out.error).toMatchObject({ code: 'VALIDATION', message: EXPIRED });
  });

  test('aksi selain cek ulang menolak proofPhotoIds; lebih dari 5 atau ganda ditolak', async () => {
    await seedOne();
    await draft('p1');
    expect((await act('note', { message: 'x', proofPhotoIds: ['p1'] })).error?.code).toBe(
      'VALIDATION',
    );
    expect((await act('recheck', { proofPhotoIds: ['p1', 'p1'] })).error?.code).toBe('VALIDATION');
    const many = Array.from({ length: 6 }, (_, i) => `x${i}`);
    expect((await act('recheck', { proofPhotoIds: many })).error?.code).toBe('VALIDATION');
    expect((await findProof(env.DB, 'p1'))?.state).toBe('draft');
  });

  test('aksi dikirim ulang setelah balasan hilang: gagal usang dan foto baru tetap draft', async () => {
    await seedOne();
    await draft('p1');
    await draft('p2');
    expect((await act('recheck', { proofPhotoIds: ['p1'] })).ok).toBe(true);
    const retry = await act('recheck', { proofPhotoIds: ['p2'] });
    expect(retry.ok).toBe(false);
    expect(retry.error?.code).toBe('CONFLICT');
    expect((await findProof(env.DB, 'p2'))?.state).toBe('draft');
    expect((await findProof(env.DB, 'p1'))?.state).toBe('queued');
    expect(await proofJobs()).toHaveLength(1);
  });
});

describe('DTO foto bukti', () => {
  test('hasProofPhotos di daftar dan detail; proofPhotos pada kejadian terkait dengan status campur', async () => {
    await seedSerial(env, { id: 'sn-no', serial: 'NOFOTO' });
    await draft('p1');
    await draft('p2');
    const saved = await save([row({ serial: 'SN-FOTO', proofPhotoIds: ['p1', 'p2'] })]);
    const serialId = saved.data.results[0].id as string;
    await setProofState(env.DB, 'p2', {
      state: 'done',
      now: SAVED_AT,
      mime: 'image/webp',
      size: 500,
      width: 640,
      height: 560,
    }).run();
    await setProofState(env.DB, 'p1', {
      state: 'failed',
      now: SAVED_AT,
      lastError: 'Berkas rusak',
    }).run();

    for (const email of [W, VIEWER]) {
      const list = await call(email, 'serials.list', {});
      const byId = new Map(list.data.items.map((item: Json) => [item.id, item]));
      expect([email, (byId.get(serialId) as Json).hasProofPhotos]).toEqual([email, true]);
      expect([email, (byId.get('sn-no') as Json).hasProofPhotos]).toEqual([email, false]);
      const detail = await call(email, 'serials.get', { id: serialId });
      expect(detail.data.serial.hasProofPhotos).toBe(true);
      const recorded = detail.data.events.find((event: Json) => event.type === 'recorded');
      expect(recorded.proofPhotos).toEqual([
        {
          id: 'p1',
          state: 'failed',
          mime: 'image/jpeg',
          size: 1000,
          width: 640,
          height: 480,
          filename: 'bukti-p1.jpg',
          error: 'Berkas rusak',
          canManage: email === W,
        },
        {
          id: 'p2',
          state: 'done',
          mime: 'image/webp',
          size: 500,
          width: 640,
          height: 560,
          filename: 'bukti-p2.webp',
          error: null,
          canManage: email === W,
        },
      ]);
      const noPhoto = await call(email, 'serials.get', { id: 'sn-no' });
      expect(noPhoto.data.serial.hasProofPhotos).toBe(false);
      expect(noPhoto.data.events.every((event: Json) => event.proofPhotos.length === 0)).toBe(true);
      const history = await call(email, 'serials.history', { id: serialId });
      expect(history.data.events.find((e: Json) => e.type === 'recorded').proofPhotos).toHaveLength(
        2,
      );
    }
  });

  test('foto pada serial BU lain tidak terlihat: detail serial BU lain = NOT_FOUND', async () => {
    await draft('p1', OTHER);
    const saved = await save([row({ buId: 'bu-b', itemId: 'i-b', proofPhotoIds: ['p1'] })], OTHER);
    const serialId = saved.data.results[0].id as string;
    expect((await call(W, 'serials.get', { id: serialId })).error?.code).toBe('NOT_FOUND');
    const list = await call(W, 'serials.list', {});
    expect(list.data.items.some((item: Json) => item.id === serialId)).toBe(false);
  });
});
