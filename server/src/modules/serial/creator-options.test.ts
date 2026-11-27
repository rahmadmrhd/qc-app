// Filter "Dicatat oleh" (`serials.list` createdBys) dan pilihan pencatat (`serials.creatorOptions`).
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { validateListSerialCreatorOptions, validateSerialList } from './validate';

setDefaultTimeout(60_000);

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
const call = async (email: string, id: string, input: unknown): Promise<Json> =>
  restCall(env, email, id, input);

const RINA = 'rina@gmail.com';
const RAMA = 'rama@gmail.com';
const TANPA_BARIS = 'tanpa-baris@gmail.com';
const DI_B = 'orang-b@gmail.com';

beforeEach(async () => {
  env = await createTestEnv();
  await seedSerialWorld(env);
  await seedUser(env, { id: 'u-rina', email: RINA, name: 'Rina Wati' });
  await seedUser(env, { id: 'u-rama', email: RAMA, name: 'Rama Dewa' });
  await seedUser(env, { id: 'u-b', email: DI_B, name: 'Orang Bravo' });
  await seedSerial(env, {
    id: 's1',
    serial: 'SN1',
    createdBy: RINA,
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  await seedSerial(env, {
    id: 's2',
    serial: 'SN2',
    createdBy: RAMA,
    createdAt: '2026-11-02T00:00:00.000Z',
  });
  await seedSerial(env, {
    id: 's3',
    serial: 'SN3',
    createdBy: TANPA_BARIS,
    createdAt: '2026-11-03T00:00:00.000Z',
  });
  await seedSerial(env, {
    id: 's4',
    serial: 'SN4',
    buId: 'bu-b',
    itemId: 'i-b',
    createdBy: DI_B,
    createdAt: '2026-11-04T00:00:00.000Z',
  });
});

const ids = (data: Json): string[] => data.items.map((row: Json) => row.id);

describe('serials.list createdBys', () => {
  test('jamak menyaring, tunggal tetap bekerja, jamak menang', async () => {
    const both = SERIAL_USERS.both;
    const many = await call(both, 'serials.list', { createdBys: [RINA, DI_B] });
    expect(ids(many.data).sort()).toEqual(['s1', 's4']);
    const single = await call(both, 'serials.list', { createdBy: RAMA });
    expect(ids(single.data)).toEqual(['s2']);
    const win = await call(both, 'serials.list', { createdBy: RAMA, createdBys: [RINA] });
    expect(ids(win.data)).toEqual(['s1']);
  });

  test('hanya menyempit: pencatat BU B tak terlihat bagi pengguna BU A', async () => {
    const result = await call(SERIAL_USERS.viewer, 'serials.list', { createdBys: [DI_B, RINA] });
    expect(ids(result.data)).toEqual(['s1']);
  });

  test('validator: kosong, duplikat tak berarti, dan lebih dari 20 ditolak', () => {
    expect(() => validateSerialList({ createdBys: [] })).toThrow();
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@gmail.com`);
    expect(() => validateSerialList({ createdBys: many })).toThrow();
    expect(validateSerialList({ createdBys: [RINA] }).createdBys).toEqual([RINA]);
  });
});

describe('serials.creatorOptions', () => {
  test('memuat pencatat serial yang boleh dibaca, tanpa kebocoran lintas BU', async () => {
    const viewer = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', {});
    expect(viewer.ok).toBe(true);
    expect(viewer.data.items.map((row: Json) => row.email)).toEqual([RAMA, RINA, TANPA_BARIS]);
    expect(viewer.data.nextCursor).toBeNull();
    const both = await call(SERIAL_USERS.both, 'serials.creatorOptions', {});
    expect(both.data.items.map((row: Json) => row.email)).toContain(DI_B);
  });

  test('nama dari baris pengguna; tanpa baris pengguna = email', async () => {
    const result = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', {});
    expect(result.data.items).toContainEqual({ email: RINA, name: 'Rina Wati' });
    expect(result.data.items).toContainEqual({ email: TANPA_BARIS, name: TANPA_BARIS });
  });

  test('pencarian nama atau email (min. 2 karakter)', async () => {
    const byName = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', { query: 'wati' });
    expect(byName.data.items.map((row: Json) => row.email)).toEqual([RINA]);
    // 'wa' ada di nama 'Rina Wati' dan 'Rama Dewa' (bukan di email mana pun).
    const byName2 = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', { query: 'wa' });
    expect(byName2.data.items.map((row: Json) => row.email)).toEqual([RAMA, RINA]);
    // Awalan email: 'ra' hanya cocok dengan rama@ ('rina@' tidak berawalan 'ra').
    const byEmail = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', { query: 'ra' });
    expect(byEmail.data.items.map((row: Json) => row.email)).toEqual([RAMA]);
    // Pencatat BU B yang namanya cocok tidak bocor ke pembaca BU A.
    const leak = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', { query: 'orang' });
    expect(leak.data.items).toEqual([]);
    const noRow = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', { query: 'tanpa' });
    expect(noRow.data.items.map((row: Json) => row.email)).toEqual([TANPA_BARIS]);
    const short = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', { query: 'r' });
    expect(short.ok).toBe(false);
  });

  test('serial yang pernah di BU yang terbaca (riwayat) ikut, serial BU lain tidak', async () => {
    await seedSerial(env, {
      id: 's5',
      serial: 'SN5',
      buId: 'bu-b',
      itemId: 'i-b',
      createdBy: 'pindah@gmail.com',
      createdAt: '2026-11-05T00:00:00.000Z',
    });
    await env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ('s5', 'bu-a', '2026-11-05T00:00:00.000Z', '2026-11-06T00:00:00.000Z')",
    ).run();
    const viewer = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', {});
    const emails = viewer.data.items.map((row: Json) => row.email);
    expect(emails).toContain('pindah@gmail.com');
    expect(emails).not.toContain(DI_B);
    // Serial yang sama terhitung sekali walau terbaca lewat dua cabang (BU saat ini dan riwayat) bagi pembaca dua BU.
    const both = await call(SERIAL_USERS.both, 'serials.creatorOptions', {});
    expect(both.data.items.filter((row: Json) => row.email === 'pindah@gmail.com')).toHaveLength(1);
  });

  test('mode ids meresolusi nama nilai terpilih dan tetap dalam hak baca', async () => {
    const result = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', {
      ids: [RINA, DI_B],
    });
    expect(result.data.items).toEqual([{ email: RINA, name: 'Rina Wati' }]);
  });

  test('limit dan kursor menelusuri semua tanpa duplikat', async () => {
    const first = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', { limit: 2 });
    expect(first.data.items).toHaveLength(2);
    expect(first.data.nextCursor).toBe(first.data.items[1].email);
    const second = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', {
      limit: 2,
      cursor: first.data.nextCursor,
    });
    expect(second.data.items.map((row: Json) => row.email)).toEqual([TANPA_BARIS]);
    expect(second.data.nextCursor).toBeNull();
  });

  test('serial terhapus tak dihitung; pengguna tanpa hak BU mendapat daftar kosong', async () => {
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = '2026-11-05T00:00:00.000Z' WHERE id = 's2'",
    ).run();
    const viewer = await call(SERIAL_USERS.viewer, 'serials.creatorOptions', {});
    expect(viewer.data.items.map((row: Json) => row.email)).not.toContain(RAMA);
    const nobu = await call(SERIAL_USERS.nobu, 'serials.creatorOptions', {});
    expect(nobu.ok === false || nobu.data.items.length === 0).toBe(true);
  });

  test('validator: ids maks. 20, limit 1-100', () => {
    expect(() =>
      validateListSerialCreatorOptions({
        ids: Array.from({ length: 21 }, (_, i) => `u${i}@x.com`),
      }),
    ).toThrow();
    expect(() => validateListSerialCreatorOptions({ limit: 101 })).toThrow();
    expect(() => validateListSerialCreatorOptions({ query: 'a' })).toThrow();
  });
});
