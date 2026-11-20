// Visibilitas baca lewat riwayat BU (spek serial unik se-sistem §5.3): serial yang pernah di sebuah BU tetap terbaca
// BU itu (daftar, detail, linimasa, berkas bukti, notifikasi) tetapi tidak pernah dapat ditulis/ditindak olehnya.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { hasSerialReadAccess } from '../notification/recipients';
import { moveBuStatements } from './bu-history';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

const A_WRITER = SERIAL_USERS.writer; // serial: edit di BU A
const A_VIEWER = SERIAL_USERS.viewer; // serial: view di BU A
const BOTH = SERIAL_USERS.both; // serial: edit di BU A dan B
const C_USER = 'pengguna-c@gmail.com'; // serial: edit di BU C saja

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (): Uint8Array => {
  const bytes = new Uint8Array(16);
  bytes.set(PNG_HEAD, 0);
  return bytes;
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-14T03:00:00.000Z'));
  rest = restClient(env);
  await seedSerialWorld(env);
  await seedBusinessUnit(env, { id: 'bu-c', code: 'C' });
  await seedUser(env, {
    id: 'u-c',
    email: C_USER,
    buAssignments: [{ buId: 'bu-c', roleIds: ['r-edit'] }],
  });
  // sn-pindah: dicatat di A, lalu pindah ke B. sn-tetap: tetap di A. sn-b: milik B sejak awal.
  await seedSerial(env, { id: 'sn-pindah', serial: 'MOVE1', buId: 'bu-a', itemId: 'i-a1' });
  await seedSerial(env, { id: 'sn-tetap', serial: 'STAY1', buId: 'bu-a', itemId: 'i-a1' });
  await seedSerial(env, { id: 'sn-b', serial: 'BEE1', buId: 'bu-b', itemId: 'i-b' });
  await env.DB.batch(
    moveBuStatements(env, {
      serialId: 'sn-pindah',
      fromBuId: 'bu-a',
      toBuId: 'bu-b',
      now: '2026-11-13T00:00:00.000Z',
    }),
  );
});

const serialsOf = async (email: string, extra: Record<string, unknown> = {}) => {
  const result = await call(email, 'serials.list', extra);
  expect(result.ok).toBe(true);
  return (result.data.items as Json[]).map((item) => item.serial as string).sort();
};

describe('baca lewat riwayat BU', () => {
  test('BU lama (A) tetap melihat serial yang pindah ke B di daftar; BU saat ini juga; BU lain tidak', async () => {
    expect(await serialsOf(A_WRITER)).toEqual(['MOVE1', 'STAY1']);
    expect(await serialsOf(A_VIEWER)).toEqual(['MOVE1', 'STAY1']);
    expect(await serialsOf(BOTH)).toEqual(['BEE1', 'MOVE1', 'STAY1']);
    expect(await serialsOf(C_USER)).toEqual([]);
  });

  test('detail menampilkan BU saat ini (B) dan riwayat BU; BU lama membacanya, BU lain NOT_FOUND', async () => {
    const detail = await call(A_VIEWER, 'serials.get', { id: 'sn-pindah' });
    expect(detail.ok).toBe(true);
    expect(detail.data.serial).toMatchObject({ buId: 'bu-b', buCode: 'B' });
    expect(detail.data.serial.buHistory).toEqual([
      {
        buId: 'bu-a',
        buCode: 'A',
        firstAt: '2026-11-12T00:00:00.000Z',
        leftAt: '2026-11-13T00:00:00.000Z',
      },
      { buId: 'bu-b', buCode: 'B', firstAt: '2026-11-13T00:00:00.000Z', leftAt: '' },
    ]);
    const other = await call(C_USER, 'serials.get', { id: 'sn-pindah' });
    expect(other.ok).toBe(false);
    expect(other.error.code).toBe('NOT_FOUND');
  });

  test('linimasa: BU lama membaca seluruh riwayat; BU lain NOT_FOUND', async () => {
    const history = await call(A_VIEWER, 'serials.history', { id: 'sn-pindah' });
    expect(history.ok).toBe(true);
    expect(history.data.counts.all).toBe(1);
    const other = await call(C_USER, 'serials.history', { id: 'sn-pindah' });
    expect(other.ok).toBe(false);
    expect(other.error.code).toBe('NOT_FOUND');
  });

  test('berkas pesan serial: terbaca BU lama dan BU saat ini; BU lain 404', async () => {
    const upload = await rest.post('/files?width=2&height=2', {
      email: A_WRITER,
      raw: png(),
      headers: { 'content-type': 'image/png' },
    });
    expect(upload.status).toBe(201);
    const id = (await jsonOf(upload)).id as string;
    await env.DB.prepare("UPDATE files SET owner_type = 'serial', owner_id = ? WHERE id = ?")
      .bind('sn-pindah', id)
      .run();
    expect((await rest.get(`/files/${id}`, { email: A_VIEWER })).status).toBe(200);
    expect((await rest.get(`/files/${id}`, { email: BOTH })).status).toBe(200);
    expect((await rest.get(`/files/${id}`, { email: C_USER })).status).toBe(404);
  });

  test('akses baca notifikasi serial mengikuti riwayat BU', async () => {
    const user = async (email: string) => {
      const ctx = await loadUserContext(env, email);
      if (!ctx) throw new Error('pengguna uji tidak ditemukan');
      return ctx;
    };
    expect(await hasSerialReadAccess(env, await user(A_VIEWER), 'sn-pindah')).toBe(true);
    expect(await hasSerialReadAccess(env, await user(C_USER), 'sn-pindah')).toBe(false);
  });
});

describe('tulis dan tindak hanya BU saat ini', () => {
  test('BU lama tidak dapat mengubah serial yang sudah pindah; BU saat ini dapat', async () => {
    const fields = {
      serial: 'MOVE1',
      itemId: 'i-a1',
      testDate: '2026-11-12',
      sample: false,
      note: 'diubah',
      locationId: 'loc-sby',
    };
    const stamp = (await call(BOTH, 'serials.get', { id: 'sn-pindah' })).data.serial
      .updatedAt as string;
    const denied = await call(A_WRITER, 'serials.update', {
      id: 'sn-pindah',
      expectedUpdatedAt: stamp,
      ...fields,
    });
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe('NOT_FOUND');
    const allowed = await call(BOTH, 'serials.update', {
      id: 'sn-pindah',
      expectedUpdatedAt: stamp,
      ...fields,
      itemId: 'i-a2',
    });
    expect(allowed.ok).toBe(true);
  });

  test('BU lama tidak dapat menindak (aksi) serial yang sudah pindah', async () => {
    const stamp = (await call(BOTH, 'serials.get', { id: 'sn-pindah' })).data.serial
      .updatedAt as string;
    const denied = await call(A_WRITER, 'serials.act', {
      id: 'sn-pindah',
      expectedUpdatedAt: stamp,
      action: 'note',
      occurredOn: '2026-11-13',
      message: 'halo',
    });
    expect(denied.ok).toBe(false);
  });
});

describe('filter BU dan kursor', () => {
  test('filter BU = serial yang PERNAH di BU itu (A: pindah dan tetap; B: pindah dan milik B)', async () => {
    expect(await serialsOf(BOTH, { buId: 'bu-a' })).toEqual(['MOVE1', 'STAY1']);
    expect(await serialsOf(BOTH, { buId: 'bu-b' })).toEqual(['BEE1', 'MOVE1']);
    expect(await serialsOf(BOTH, { buId: 'bu-c' })).toEqual([]);
    // Filter BU tak melonggarkan hak baca: BU A saja tak melihat serial yang tak pernah lewat BU-nya.
    expect(await serialsOf(A_WRITER, { buId: 'bu-b' })).toEqual(['MOVE1']);
  });

  test('rantai A lalu B lalu C: pembaca A melihatnya; filter B (pernah ditinggalkan) dan C (saat ini) menemukannya', async () => {
    await seedBusinessUnit(env, { id: 'bu-d', code: 'D' });
    await seedSerial(env, { id: 'sn-chain', serial: 'CHAIN1', buId: 'bu-a', itemId: 'i-a1' });
    for (const [from, to, now] of [
      ['bu-a', 'bu-b', '2026-11-13T01:00:00.000Z'],
      ['bu-b', 'bu-c', '2026-11-13T02:00:00.000Z'],
    ] as const) {
      await env.DB.batch(
        moveBuStatements(env, { serialId: 'sn-chain', fromBuId: from, toBuId: to, now }),
      );
    }
    expect(await serialsOf(A_WRITER)).toEqual(['CHAIN1', 'MOVE1', 'STAY1']);
    expect(await serialsOf(A_WRITER, { buId: 'bu-b' })).toEqual(['CHAIN1', 'MOVE1']);
    expect(await serialsOf(A_WRITER, { buId: 'bu-c' })).toEqual(['CHAIN1']);
    expect(await serialsOf(A_WRITER, { buId: 'bu-d' })).toEqual([]);
    expect(await serialsOf(C_USER)).toEqual(['CHAIN1']);
    expect(await serialsOf(C_USER, { buId: 'bu-a' })).toEqual(['CHAIN1']);
  });

  test('ukuran halaman dan kursor tetap benar dengan serial yang terlihat lewat riwayat', async () => {
    await seedSerial(env, {
      id: 'sn-3',
      serial: 'THREE1',
      buId: 'bu-a',
      itemId: 'i-a1',
      createdAt: '2026-11-12T00:00:01.000Z',
    });
    const first = await call(A_WRITER, 'serials.list', { limit: 2 });
    expect(first.data.items).toHaveLength(2);
    expect(first.data.nextCursor).not.toBeNull();
    const second = await call(A_WRITER, 'serials.list', {
      limit: 2,
      cursor: first.data.nextCursor,
    });
    expect(second.data.items).toHaveLength(1);
    expect(second.data.nextCursor).toBeNull();
    const all = [...first.data.items, ...second.data.items].map((i: Json) => i.serial).sort();
    expect(all).toEqual(['MOVE1', 'STAY1', 'THREE1']);
  });
});
