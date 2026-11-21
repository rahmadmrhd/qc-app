// Filter jamak OPSIONAL (revisi tampilan lanjutan 2026-11-22, B2b) di lima daftar: items, serials, serialCases,
// handovers.board, dan audit. Aturan bersama: field tunggal lama tetap bekerja, yang jamak menang bila keduanya ada,
// daftar tak kosong/tanpa duplikat/maks. 20 nilai/nilai sah (VALIDATION), dan filter HANYA menyempit (id BU yang tak
// terbaca tidak membuka data baru).
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { writeAudit } from '@server/core/audit';
import { FILTER_LIST_MAX, readFilterList, readObject } from '@server/core/validate';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { callRest, ENV, seedHandover, seedHandoverEnv } from '@server-test/handover-env';
import { brandIdOf, seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { seedGuideImage, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(120_000);

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

const ADMIN = 'admin@gmail.com';
const ids = (result: CallOut, key = 'items'): string[] =>
  ((result.data as Json)[key] as Json[]).map((row) => row.id as string).sort();

describe('readFilterList', () => {
  const read = (value: unknown, options?: Parameters<typeof readFilterList>[2]) => {
    const reader = readObject({ v: value });
    const list = readFilterList(reader, 'v', options);
    let failed = false;
    try {
      reader.done();
    } catch {
      failed = true;
    }
    return { list, failed };
  };

  test('tiada = undefined; daftar sah dipangkas; pelanggaran gagal', () => {
    expect(read(undefined)).toEqual({ list: undefined, failed: false });
    expect(read(null)).toEqual({ list: undefined, failed: false });
    expect(read([' a ', 'b'])).toEqual({ list: ['a', 'b'], failed: false });
    expect(read([]).failed).toBe(true);
    expect(read('a,b').failed).toBe(true);
    expect(read(['a', 1]).failed).toBe(true);
    expect(read(['a', 'a']).failed).toBe(true);
    expect(read(['a', ' a ']).failed).toBe(true);
    expect(read(['a', '']).failed).toBe(true);
    expect(read(['x'.repeat(101)]).failed).toBe(true);
    expect(read(['x'.repeat(41)], { maxLength: 40 }).failed).toBe(true);
    expect(read(['a', 'z'], { allowed: ['a', 'b'] }).failed).toBe(true);
    expect(read(['a', 'b'], { allowed: ['a', 'b'] }).failed).toBe(false);
    const many = Array.from({ length: FILTER_LIST_MAX }, (_, index) => `v${index}`);
    expect(read(many).failed).toBe(false);
    expect(read([...many, 'lagi']).failed).toBe(true);
  });
});

async function expectValidation(id: string, input: unknown, email = ADMIN): Promise<void> {
  const result = await call(email, id, input);
  expect([id, JSON.stringify(input), result.ok]).toEqual([id, JSON.stringify(input), false]);
  expect(result.error.code).toBe('VALIDATION');
}

const TOO_MANY = Array.from({ length: FILTER_LIST_MAX + 1 }, (_, index) => `v${index}`);

describe('items.list: brandIds, buIds, typeIds', () => {
  beforeEach(async () => {
    env = await createTestEnv();
    env.clock.set(Date.parse('2026-11-22T03:00:00.000Z'));
    await seedBusinessUnit(env, { id: 'bu-a', code: 'AAA' });
    await seedBusinessUnit(env, { id: 'bu-b', code: 'BBB' });
    await seedRole(env, { id: 'r-iv', name: 'Item view', permissions: { item: 'view' } });
    await seedUser(env, { id: 'u-all', email: 'all@gmail.com', roleIds: ['r-iv'] });
    await seedUser(env, {
      id: 'u-a',
      email: 'bua@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-iv'] }],
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-iv'] }],
    });
    await seedBrand(env, 'PBE');
    await seedBrand(env, 'ACME');
    await seedBrand(env, 'ZETA');
    await seedItem(env, { id: 'i1', brand: 'PBE', model: 'M1', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'i2', brand: 'ACME', model: 'M2', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'i3', brand: 'PBE', model: 'M3', businessUnitIds: ['bu-b'] });
    await seedItem(env, {
      id: 'i4',
      brand: 'ZETA',
      model: 'M4',
      businessUnitIds: ['bu-a', 'bu-b'],
    });
  });

  const list = (email: string, input: Record<string, unknown>) =>
    call(email, 'items.list', { limit: 50, ...input });

  test('brandIds: salah satu merk; tunggal lama tetap; jamak menang atas tunggal', async () => {
    const pbe = brandIdOf('PBE');
    const acme = brandIdOf('ACME');
    expect(ids(await list(ADMIN, { brandIds: [pbe, acme] }))).toEqual(['i1', 'i2', 'i3']);
    expect(ids(await list(ADMIN, { brandId: pbe }))).toEqual(['i1', 'i3']);
    expect(ids(await list(ADMIN, { brandId: pbe, brandIds: [acme] }))).toEqual(['i2']);
  });

  test('buIds: item di salah satu BU; tak melebar bagi pembaca BU lain (BU tak terbaca diabaikan)', async () => {
    expect(ids(await list('all@gmail.com', { buIds: ['bu-a', 'bu-b'] }))).toEqual([
      'i1',
      'i2',
      'i3',
      'i4',
    ]);
    expect(ids(await list('all@gmail.com', { buId: 'bu-b' }))).toEqual(['i3', 'i4']);
    expect(ids(await list('all@gmail.com', { buId: 'bu-b', buIds: ['bu-a'] }))).toEqual([
      'i1',
      'i2',
      'i4',
    ]);
    // Pembaca BU A saja: menyebut BU B (tak terbaca) tidak membuka i3; i4 (A dan B) tetap terlihat karena beririsan.
    expect(ids(await list('bua@gmail.com', { buIds: ['bu-a', 'bu-b'] }))).toEqual([
      'i1',
      'i2',
      'i4',
    ]);
    expect(ids(await list('bua@gmail.com', { buIds: ['bu-b'] }))).toEqual(['i4']);
    expect(ids(await list('bua@gmail.com', { buIds: ['bu-tak-ada'] }))).toEqual([]);
  });

  test('typeIds: penanda salah satu jenis; mode missing kebalikannya; tunggal lama tetap; tak boleh bersama stickerId', async () => {
    await seedGuideImage(env, { id: 'g1' });
    await seedStickerType(env, { id: 't1', rule: 'none' });
    await seedStickerType(env, { id: 't2', rule: 'none' });
    await seedStickerType(env, { id: 't3', rule: 'none' });
    await seedSticker(env, { id: 's1', typeId: 't1' });
    for (const [itemId, typeId, stickerId] of [
      ['i1', 't1', ''],
      ['i2', '', 's1'],
      ['i3', 't2', ''],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO item_sticker_photos (item_id, guide_id, caption, bu_id, `position`) VALUES (?, 'g1', '', '', 0)",
      )
        .bind(itemId)
        .run();
      await env.DB.prepare(
        "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES (?, 'g1', 0, 1, 1, ?, ?, '')",
      )
        .bind(itemId, stickerId, typeId)
        .run();
    }
    expect(ids(await list(ADMIN, { typeIds: ['t1', 't2'] }))).toEqual(['i1', 'i2', 'i3']);
    expect(ids(await list(ADMIN, { typeIds: ['t1', 't2'], stickerMode: 'missing' }))).toEqual([
      'i4',
    ]);
    expect(ids(await list(ADMIN, { typeId: 't1' }))).toEqual(['i1', 'i2']);
    expect(ids(await list(ADMIN, { typeId: 't1', typeIds: ['t2'] }))).toEqual(['i3']);
    expect(ids(await list(ADMIN, { typeIds: ['t3'] }))).toEqual([]);
    await expectValidation('items.list', { typeIds: ['t1'], stickerId: 's1' });
  });

  test('daftar kosong, ganda, lebih dari 20 nilai, atau bukan daftar = VALIDATION', async () => {
    for (const key of ['brandIds', 'buIds', 'typeIds']) {
      await expectValidation('items.list', { [key]: [] });
      await expectValidation('items.list', { [key]: ['a', 'a'] });
      await expectValidation('items.list', { [key]: TOO_MANY });
      await expectValidation('items.list', { [key]: 'a' });
    }
  });
});

describe('serials.list dan serialCases.list: filter jamak', () => {
  beforeEach(async () => {
    env = await createTestEnv();
    env.clock.set(Date.parse('2026-11-22T03:00:00.000Z'));
    await seedSerialWorld(env);
    await seedSerial(env, { id: 'sn1', serial: 'SN-1', buId: 'bu-a', itemId: 'i-a1' });
    await seedSerial(env, {
      id: 'sn2',
      serial: 'SN-2',
      buId: 'bu-a',
      itemId: 'i-a2',
      locationId: 'loc-jkt',
      status: 'reported',
      custody: 'qc',
      openCase: { id: 'c2', number: 'LP/A/2611-0002' },
    });
    await seedSerial(env, {
      id: 'sn3',
      serial: 'SN-3',
      buId: 'bu-b',
      itemId: 'i-b',
      status: 'at_service',
      custody: 'service',
      openCase: { id: 'c3', number: 'LP/B/2611-0003' },
    });
  });

  const list = (email: string, input: Record<string, unknown>) =>
    call(email, 'serials.list', { limit: 50, ...input });

  test('buIds: pernah/ada di salah satu BU; tunggal lama tetap; jamak menang; BU tak terbaca tak membuka data', async () => {
    const both = SERIAL_USERS.both;
    expect(ids(await list(both, { buIds: ['bu-a', 'bu-b'] }))).toEqual(['sn1', 'sn2', 'sn3']);
    expect(ids(await list(both, { buId: 'bu-b' }))).toEqual(['sn3']);
    expect(ids(await list(both, { buId: 'bu-b', buIds: ['bu-a'] }))).toEqual(['sn1', 'sn2']);
    // Pembaca BU A saja: BU B di daftar jamak diabaikan, sn3 tidak bocor.
    const viewer = SERIAL_USERS.viewer;
    expect(ids(await list(viewer, { buIds: ['bu-a', 'bu-b'] }))).toEqual(['sn1', 'sn2']);
    expect(ids(await list(viewer, { buIds: ['bu-b'] }))).toEqual([]);
  });

  test('itemIds, locationIds, statuses, custodies: salah satu nilai; tunggal lama tetap; jamak menang', async () => {
    const both = SERIAL_USERS.both;
    expect(ids(await list(both, { itemIds: ['i-a1', 'i-b'] }))).toEqual(['sn1', 'sn3']);
    expect(ids(await list(both, { itemId: 'i-a1', itemIds: ['i-b'] }))).toEqual(['sn3']);
    expect(ids(await list(both, { locationIds: ['loc-jkt', 'loc-tak-ada'] }))).toEqual(['sn2']);
    expect(ids(await list(both, { locationId: 'loc-jkt' }))).toEqual(['sn2']);
    expect(ids(await list(both, { statuses: ['reported', 'at_service'] }))).toEqual(['sn2', 'sn3']);
    expect(ids(await list(both, { status: 'good' }))).toEqual(['sn1']);
    expect(ids(await list(both, { status: 'good', statuses: ['at_service'] }))).toEqual(['sn3']);
    expect(ids(await list(both, { custodies: ['qc', 'service'] }))).toEqual(['sn1', 'sn2', 'sn3']);
    expect(ids(await list(both, { custody: 'service' }))).toEqual(['sn3']);
    expect(ids(await list(both, { custody: 'service', custodies: ['qc'] }))).toEqual([
      'sn1',
      'sn2',
    ]);
    // Gabungan beberapa filter jamak = irisan.
    expect(
      ids(
        await list(both, {
          buIds: ['bu-a', 'bu-b'],
          statuses: ['good', 'reported'],
          custodies: ['qc'],
        }),
      ),
    ).toEqual(['sn1', 'sn2']);
  });

  test('daftar kosong, ganda, lebih dari 20 nilai, bukan daftar, atau enum tak sah = VALIDATION', async () => {
    for (const key of ['buIds', 'itemIds', 'locationIds', 'statuses', 'custodies']) {
      await expectValidation('serials.list', { [key]: [] });
      await expectValidation('serials.list', { [key]: ['qc', 'qc'] });
      await expectValidation('serials.list', { [key]: TOO_MANY });
      await expectValidation('serials.list', { [key]: 'qc' });
    }
    await expectValidation('serials.list', { statuses: ['bukan-status'] });
    await expectValidation('serials.list', { custodies: ['bukan-posisi'] });
  });

  test('serialCases.list buIds: tunggal lama tetap, jamak menang, BU tak terbaca tak membuka data', async () => {
    const both = SERIAL_USERS.both;
    const cases = (email: string, input: Record<string, unknown>) =>
      call(email, 'serialCases.list', input);
    expect(ids(await cases(both, { buIds: ['bu-a', 'bu-b'] }))).toEqual(['c2', 'c3']);
    expect(ids(await cases(both, { buId: 'bu-b' }))).toEqual(['c3']);
    expect(ids(await cases(both, { buId: 'bu-b', buIds: ['bu-a'] }))).toEqual(['c2']);
    expect(ids(await cases(SERIAL_USERS.viewer, { buIds: ['bu-a', 'bu-b'] }))).toEqual(['c2']);
    expect(ids(await cases(SERIAL_USERS.viewer, { buIds: ['bu-b'] }))).toEqual([]);
    for (const input of [{ buIds: [] }, { buIds: ['a', 'a'] }, { buIds: TOO_MANY }]) {
      await expectValidation('serialCases.list', input, both);
    }
  });
});

describe('handovers.board customerIds', () => {
  beforeEach(async () => {
    env = await createTestEnv();
    env.clock.set(Date.parse('2026-11-22T03:00:00.000Z'));
    await seedHandoverEnv(env);
    await seedHandover(env, { id: 'h1', number: 'ST-1', locationId: ENV.locA, customerId: 'cu-1' });
    await seedHandover(env, { id: 'h2', number: 'ST-2', locationId: ENV.locA, customerId: 'cu-2' });
    await seedHandover(env, { id: 'h3', number: 'ST-3', locationId: ENV.locA, customerId: 'cu-3' });
    // Lokasi lain: tidak terbaca pemegang loc-a saja.
    await seedHandover(env, { id: 'h4', number: 'ST-4', locationId: ENV.locB, customerId: 'cu-1' });
  });

  const board = async (input: Record<string, unknown>, email = 'wh@gmail.com'): Promise<CallOut> =>
    (await callRest(env, email, 'handovers.board', {
      locationIds: [ENV.locA],
      status: 'new',
      ...input,
    })) as CallOut;

  test('customerIds: salah satu customer; tunggal lama tetap; jamak menang; hitungan kolom ikut', async () => {
    const result = await board({ customerIds: ['cu-1', 'cu-2'] });
    expect(result.ok).toBe(true);
    expect(ids(result)).toEqual(['h1', 'h2']);
    expect(result.data.total).toBe(2);
    expect(ids(await board({ customerId: 'cu-3' }))).toEqual(['h3']);
    expect(ids(await board({ customerId: 'cu-3', customerIds: ['cu-1'] }))).toEqual(['h1']);
    // Hak lokasi tetap: h4 (loc-b) tak ikut walau customer cocok.
    expect(ids(await board({ customerIds: ['cu-1'] }))).toEqual(['h1']);
  });

  test('daftar kosong, ganda, atau lebih dari 20 nilai = VALIDATION', async () => {
    for (const customerIds of [[], ['a', 'a'], TOO_MANY]) {
      const result = await board({ customerIds });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('VALIDATION');
    }
  });
});

describe('access.audit.list actions', () => {
  beforeEach(async () => {
    env = await createTestEnv();
    env.clock.set(Date.parse('2026-11-22T03:00:00.000Z'));
    for (const [index, action] of [
      'item.create',
      'item.update',
      'brand.update',
      'user.update',
    ].entries()) {
      await writeAudit(env.DB, {
        ts: `2026-11-21T0${index}:00:00.000Z`,
        actor: 'seed@gmail.com',
        action,
        target: `t${index}`,
      }).run();
    }
  });

  const actionsOf = (result: CallOut): string[] =>
    ((result.data as Json).entries as Json[]).map((entry) => entry.action as string).sort();

  test('actions: salah satu aksi; action tunggal tetap; jamak menang atas tunggal', async () => {
    expect(
      actionsOf(
        await call(ADMIN, 'access.audit.list', { actions: ['item.create', 'user.update'] }),
      ),
    ).toEqual(['item.create', 'user.update']);
    expect(actionsOf(await call(ADMIN, 'access.audit.list', { action: 'brand.update' }))).toEqual([
      'brand.update',
    ]);
    expect(
      actionsOf(
        await call(ADMIN, 'access.audit.list', {
          action: 'brand.update',
          actions: ['item.update'],
        }),
      ),
    ).toEqual(['item.update']);
  });

  test('daftar kosong, ganda, lebih dari 20 nilai, atau nilai > 40 karakter = VALIDATION', async () => {
    for (const actions of [[], ['a', 'a'], TOO_MANY, ['x'.repeat(41)]]) {
      await expectValidation('access.audit.list', { actions });
    }
  });
});
