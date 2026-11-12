import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  await seedSerialWorld(env);
});

describe('serials.get', () => {
  test('detail memuat stiker (nama, qty), kejadian menaik dengan changes/data ter-parse', async () => {
    await seedSerial(env, {
      id: 'sn1',
      serial: '4C5E0C1A2B3D',
      note: 'catatan',
      stickers: [
        { stickerId: 's2', qty: 2 },
        { stickerId: 's1', qty: 1 },
      ],
    });
    await env.DB.prepare(
      "INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES ('e3', 'sn1', '', 3, 'note', '2026-11-12', 't', 'u', 'U', 'qc', 'halo', '[]', '{}'), ('e2', 'sn1', '', 2, 'data_changed', '2026-11-12', 't', 'u', 'U', 'qc', '', ?, ?)",
    )
      .bind(JSON.stringify([{ field: 'serial', from: 'AB12', to: 'AB13' }]), '{"k":1}')
      .run();
    const result = await call(SERIAL_USERS.writer, 'serials.get', { id: 'sn1' });
    expect(result.ok).toBe(true);
    const data = result.data as Json;
    expect(data.serial).toMatchObject({
      id: 'sn1',
      buId: 'bu-a',
      buCode: 'A',
      serial: '4C5E0C1A2B3D',
      itemLabel: 'Merk Alfa',
      locationName: 'Surabaya',
      status: 'good',
      custody: 'qc',
      note: 'catatan',
      openCaseId: null,
      recordedLocationId: 'loc-sby',
    });
    expect(data.serial.stickers).toEqual([
      { stickerId: 's1', name: 'Segel A', alias: '', qty: 1 },
      { stickerId: 's2', name: 'Segel B', alias: '', qty: 2 },
    ]);
    expect(data.events.map((e: Json) => e.seq)).toEqual([1, 2, 3]);
    expect(data.events[1]).toMatchObject({
      type: 'data_changed',
      changes: [{ field: 'serial', from: 'AB12', to: 'AB13' }],
      data: { k: 1 },
    });
  });

  test('BU di luar hak: NOT_FOUND (bukan FORBIDDEN); pembaca serialservice boleh; tanpa izin FORBIDDEN', async () => {
    await seedSerial(env, { id: 'sn-b', serial: 'B-1', buId: 'bu-b', itemId: 'i-b' });
    await seedSerial(env, { id: 'sn-a', serial: 'A-1' });
    const hidden = await call(SERIAL_USERS.writer, 'serials.get', { id: 'sn-b' });
    expect(hidden.error?.code).toBe('NOT_FOUND');
    const missing = await call(SERIAL_USERS.writer, 'serials.get', { id: 'tidak-ada' });
    expect(missing.error?.code).toBe('NOT_FOUND');
    const service = await call(SERIAL_USERS.service, 'serials.get', { id: 'sn-a' });
    expect(service.ok).toBe(true);
    const nobody = await call(SERIAL_USERS.nobu, 'serials.get', { id: 'sn-a' });
    expect(nobody.error?.code).toBe('FORBIDDEN');
  });
});

describe('serials.list', () => {
  async function seedMany(): Promise<void> {
    await seedSerial(env, {
      id: 'a1',
      serial: '4C5E0C1A2B3D',
      createdAt: '2026-11-10T01:00:00.000Z',
      testDate: '2026-11-10',
    });
    await seedSerial(env, {
      id: 'a2',
      serial: 'SN-200',
      createdAt: '2026-11-11T01:00:00.000Z',
      testDate: '2026-11-11',
      locationId: 'loc-jkt',
      createdBy: 'lain@gmail.com',
    });
    await seedSerial(env, {
      id: 'a3',
      serial: 'SN-300',
      createdAt: '2026-11-12T01:00:00.000Z',
      testDate: '2026-11-12',
      itemId: 'i-a2',
      status: 'recheck',
    });
    await seedSerial(env, { id: 'b1', serial: 'SN-400', buId: 'bu-b', itemId: 'i-b' });
  }

  test('hanya BU terbaca; urut created_at DESC; item/lokasi/status/pembuat memfilter', async () => {
    await seedMany();
    const all = (await call(SERIAL_USERS.writer, 'serials.list', {})).data as Json;
    expect(all.items.map((i: Json) => i.id)).toEqual(['a3', 'a2', 'a1']);
    const both = (await call(SERIAL_USERS.both, 'serials.list', {})).data as Json;
    expect(both.items.map((i: Json) => i.id).sort()).toEqual(['a1', 'a2', 'a3', 'b1']);
    const onlyB = (await call(SERIAL_USERS.both, 'serials.list', { buId: 'bu-b' })).data as Json;
    expect(onlyB.items.map((i: Json) => i.id)).toEqual(['b1']);
    const byItem = (await call(SERIAL_USERS.writer, 'serials.list', { itemId: 'i-a2' }))
      .data as Json;
    expect(byItem.items.map((i: Json) => i.id)).toEqual(['a3']);
    const byLoc = (await call(SERIAL_USERS.writer, 'serials.list', { locationId: 'loc-jkt' }))
      .data as Json;
    expect(byLoc.items.map((i: Json) => i.id)).toEqual(['a2']);
    const byStatus = (await call(SERIAL_USERS.writer, 'serials.list', { status: 'recheck' }))
      .data as Json;
    expect(byStatus.items.map((i: Json) => i.id)).toEqual(['a3']);
    const byUser = (
      await call(SERIAL_USERS.writer, 'serials.list', { createdBy: 'lain@gmail.com' })
    ).data as Json;
    expect(byUser.items.map((i: Json) => i.id)).toEqual(['a2']);
    expect(all.items[0]).toMatchObject({
      buCode: 'A',
      itemLabel: 'Merk Beta',
      locationName: 'Surabaya',
    });
  });

  test('tanpa BU terbaca: kosong; serialservice-saja boleh membaca', async () => {
    await seedMany();
    const viewer = (await call(SERIAL_USERS.service, 'serials.list', {})).data as Json;
    expect(viewer.items).toHaveLength(3);
    const nobody = await call(SERIAL_USERS.nobu, 'serials.list', {});
    expect(nobody.error?.code).toBe('FORBIDDEN');
  });

  test('filter tanggal inklusif; query awalan ternormalisasi; serials banyak baris', async () => {
    await seedMany();
    const range = (
      await call(SERIAL_USERS.writer, 'serials.list', { from: '2026-11-11', to: '2026-11-12' })
    ).data as Json;
    expect(range.items.map((i: Json) => i.id)).toEqual(['a3', 'a2']);
    const byPrefix = (await call(SERIAL_USERS.writer, 'serials.list', { query: 'sn-' }))
      .data as Json;
    expect(byPrefix.items.map((i: Json) => i.id)).toEqual(['a3', 'a2']);
    const macPrefix = (await call(SERIAL_USERS.writer, 'serials.list', { query: '4c:5e:0c' }))
      .data as Json;
    expect(macPrefix.items.map((i: Json) => i.id)).toEqual(['a1']);
    const exact = (
      await call(SERIAL_USERS.writer, 'serials.list', {
        serials: '4C:5E:0C:1A:2B:3D\nsn-300\n\nTIDAK-ADA',
      })
    ).data as Json;
    expect(exact.items.map((i: Json) => i.id).sort()).toEqual(['a1', 'a3']);
  });

  test('kursor: tiga halaman berukuran 2 tanpa baris terlewat atau ganda; limit 101 ditolak', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedSerial(env, {
        id: `p${i}`,
        serial: `P-${i}`,
        // Dua baris berstempel sama agar kursor kedua kunci (created_at, id) teruji.
        createdAt: i <= 2 ? '2026-11-10T00:00:00.000Z' : `2026-11-1${i}T00:00:00.000Z`,
      });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const out = (
        await call(SERIAL_USERS.writer, 'serials.list', { limit: 2, ...(cursor ? { cursor } : {}) })
      ).data as Json;
      seen.push(...out.items.map((i: Json) => i.id));
      cursor = out.nextCursor ?? undefined;
      if (page < 2) expect(cursor).toBeDefined();
    }
    expect(cursor).toBeUndefined();
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen.slice(0, 3)).toEqual(['p5', 'p4', 'p3']);
    const tooBig = await call(SERIAL_USERS.writer, 'serials.list', { limit: 101 });
    expect(tooBig.error?.code).toBe('VALIDATION');
  });

  test('validator: status tidak dikenal, tanggal rusak, lebih dari 200 baris serials', async () => {
    expect((await call(SERIAL_USERS.writer, 'serials.list', { status: 'x' })).error?.code).toBe(
      'VALIDATION',
    );
    expect(
      (await call(SERIAL_USERS.writer, 'serials.list', { from: '2026-13-01' })).error?.code,
    ).toBe('VALIDATION');
    const many = Array.from({ length: 201 }, (_, i) => `S${i}`).join('\n');
    expect((await call(SERIAL_USERS.writer, 'serials.list', { serials: many })).error?.code).toBe(
      'VALIDATION',
    );
  });
});
