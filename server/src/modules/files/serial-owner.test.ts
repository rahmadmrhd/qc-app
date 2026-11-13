// Berkas berpemilik `serial` (gambar pada pesan kejadian, 5b): terbaca hanya lewat BU serial, tak pernah lewat izin
// item/sticker/qrcode, dan tak dapat dipasang ke pemilik lain.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { planAttachFiles } from './service';

setDefaultTimeout(60_000);

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (size = 16): Uint8Array => {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_HEAD, 0);
  return bytes;
};

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const SVC_EDIT = SERIAL_USERS.svcEdit;
const B_VIEW = 'lihat-b@gmail.com';
const ITEM_ALL = 'item-semua@gmail.com';
const STICKER_VIEW = 'stiker@gmail.com';

beforeEach(async () => {
  env = await createTestEnv();
  rest = restClient(env);
  await seedSerialWorld(env);
  await seedRole(env, {
    id: 'r-item-manage',
    name: 'Item manage',
    permissions: { item: 'manage' },
  });
  await seedRole(env, { id: 'r-sticker', name: 'Stiker view', permissions: { sticker: 'view' } });
  await seedUser(env, {
    id: 'u-b-view',
    email: B_VIEW,
    buAssignments: [{ buId: 'bu-b', roleIds: ['r-view'] }],
  });
  await seedUser(env, {
    id: 'u-item',
    email: ITEM_ALL,
    buAssignments: [{ buId: null, roleIds: ['r-item-manage'] }],
  });
  await seedUser(env, { id: 'u-sticker', email: STICKER_VIEW, roleIds: ['r-sticker'] });
  await seedSerial(env, { id: 'sn-a', serial: 'AAA1', buId: 'bu-a', itemId: 'i-a1' });
  await seedSerial(env, { id: 'sn-b', serial: 'BBB1', buId: 'bu-b', itemId: 'i-b' });
});

const upload = (email: string) =>
  rest.post('/files?width=2&height=2', {
    email,
    raw: png(),
    headers: { 'content-type': 'image/png' },
  });

/** Unggah gambar sebagai `email` lalu pasang ke serial `ownerId` (keadaan sesudah aksi menyimpan kejadian). */
async function serialImage(email: string, ownerId: string): Promise<string> {
  const response = await upload(email);
  expect(response.status).toBe(201);
  const id = (await jsonOf(response)).id as string;
  await env.DB.prepare("UPDATE files SET owner_type = 'serial', owner_id = ? WHERE id = ?")
    .bind(ownerId, id)
    .run();
  return id;
}

const get = (id: string, email: string) => rest.get(`/files/${id}`, { email });

describe('pembacaan berkas serial', () => {
  test('terbaca oleh serial: view dan serialservice: view pada BU serial', async () => {
    const id = await serialImage(SERIAL_USERS.writer, 'sn-a');
    expect((await get(id, SERIAL_USERS.viewer)).status).toBe(200);
    expect((await get(id, SERIAL_USERS.service)).status).toBe(200);
    expect((await get(id, SERIAL_USERS.writer)).status).toBe(200);
    expect((await get(id, SVC_EDIT)).status).toBe(200);
  });

  test('TIDAK terbaca oleh serial: view di BU lain', async () => {
    const id = await serialImage(SERIAL_USERS.writer, 'sn-a');
    expect((await get(id, B_VIEW)).status).toBe(404);
  });

  test('TIDAK terbaca oleh item: manage semua BU tanpa izin serial, maupun sticker: view', async () => {
    const id = await serialImage(SERIAL_USERS.writer, 'sn-a');
    expect((await get(id, ITEM_ALL)).status).toBe(404);
    expect((await get(id, STICKER_VIEW)).status).toBe(404);
  });

  test('pengguna serial BU A tak membaca berkas serial BU B; pengguna dua BU membaca keduanya', async () => {
    const idB = await serialImage(SERIAL_USERS.both, 'sn-b');
    expect((await get(idB, SERIAL_USERS.viewer)).status).toBe(404);
    expect((await get(idB, SERIAL_USERS.both)).status).toBe(200);
  });

  test('pemilik serial yang tak ada (yatim) tidak terbaca', async () => {
    const id = await serialImage(SERIAL_USERS.writer, 'sn-hilang');
    expect((await get(id, SERIAL_USERS.viewer)).status).toBe(404);
  });

  test('unggahan yang belum terpasang tetap hanya terbaca pengunggahnya', async () => {
    const id = (await jsonOf(await upload(SERIAL_USERS.writer))).id as string;
    expect((await get(id, SERIAL_USERS.writer)).status).toBe(200);
    expect((await get(id, SERIAL_USERS.viewer)).status).toBe(404);
  });
});

describe('unggah dan pemasangan', () => {
  test('serialservice: edit saja boleh files.upload; tanpa izin edit = 403', async () => {
    expect((await upload(SVC_EDIT)).status).toBe(201);
    for (const email of [SERIAL_USERS.viewer, SERIAL_USERS.nobu, SERIAL_USERS.service]) {
      expect((await upload(email)).status).toBe(403);
    }
  });

  test('berkas serial dikirim ke jalur lain (item/logo QR/stiker) = VALIDATION generik', async () => {
    const id = await serialImage(SERIAL_USERS.writer, 'sn-a');
    for (const [ownerType, ownerId] of [
      ['item', 'i-a1'],
      ['qrlogo', 'shared'],
      ['sticker', 's1'],
    ] as const) {
      const error = await captureAppErrorAsync(() =>
        planAttachFiles(env, [id], ownerType, ownerId),
      );
      expect(error.code).toBe('VALIDATION');
      expect(error.message).toBe('Ada berkas yang tidak dikenal');
    }
  });

  test('berkas serial A dipasang ke serial lain = VALIDATION generik; ke serial yang sama aman diulang', async () => {
    const id = await serialImage(SERIAL_USERS.writer, 'sn-a');
    const error = await captureAppErrorAsync(() => planAttachFiles(env, [id], 'serial', 'sn-b'));
    expect(error.code).toBe('VALIDATION');
    expect(await planAttachFiles(env, [id], 'serial', 'sn-a')).toEqual([]);
  });

  test('unggahan belum terpasang dapat diklaim serial oleh pengunggahnya, bukan orang lain', async () => {
    const id = (await jsonOf(await upload(SERIAL_USERS.writer))).id as string;
    const statements = await planAttachFiles(
      env,
      [id],
      'serial',
      'sn-a',
      undefined,
      SERIAL_USERS.writer,
    );
    expect(statements).toHaveLength(1);
    const other = await captureAppErrorAsync(() =>
      planAttachFiles(env, [id], 'serial', 'sn-a', undefined, SERIAL_USERS.both),
    );
    expect(other.code).toBe('VALIDATION');
  });
});
