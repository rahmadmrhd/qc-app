import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { putSetting } from '@server/core/settings';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { daysUntil, POSTEL_ALERT_DEFAULTS } from '@shared/postel';
import { postelSoonDays } from './service';

// Kabel REST rute Postel: list, get, save, remove, itemOptions. Pengguna: admin (super), stickerview@ (sticker view),
// stickeredit@ (sticker edit + item view pada BU `bu-umum`), stickeredit-nobu@ (sticker edit tanpa penugasan BU),
// nosticker@ (item view saja).

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const realError = console.error;

const ADMIN = 'admin@gmail.com';
const EDITOR = 'stickeredit@gmail.com';
const NOBU = 'stickeredit-nobu@gmail.com';
const VIEWER = 'stickerview@gmail.com';
const NOSTICKER = 'nosticker@gmail.com';

beforeEach(async () => {
  env = await createTestEnv();
  // 10:00 WIB, 2026-11-11.
  env.clock.set(Date.parse('2026-11-11T03:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-umum', code: 'UMUM' });
  await seedRole(env, { id: 'r-sv', name: 'Sticker view', permissions: { sticker: 'view' } });
  await seedRole(env, {
    id: 'r-se',
    name: 'Sticker edit',
    permissions: { sticker: 'edit', item: 'view' },
  });
  await seedRole(env, {
    id: 'r-sen',
    name: 'Sticker edit tanpa BU',
    permissions: { sticker: 'edit' },
  });
  await seedRole(env, { id: 'r-item', name: 'Item', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-sv', email: VIEWER, roleIds: ['r-sv'] });
  await seedUser(env, {
    id: 'u-se',
    email: EDITOR,
    assignments: [{ locationId: null, roleIds: ['r-se'] }],
    buAssignments: [{ buId: 'bu-umum', roleIds: ['r-se'] }],
  });
  await seedUser(env, {
    id: 'u-sen',
    email: NOBU,
    assignments: [{ locationId: null, roleIds: ['r-sen'] }],
    buAssignments: [],
  });
  await seedUser(env, { id: 'u-ns', email: NOSTICKER, roleIds: ['r-item'] });
  await seedBrand(env, 'PBE');
  await seedItem(env, { id: 'i1', brand: 'PBE', model: 'M5-400' });
  await seedItem(env, { id: 'i2', brand: 'PBE', model: 'M5-200' });
  await seedItem(env, { id: 'i3', brand: 'PBE', model: 'M2-300' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;

type CallOut = { ok: boolean; data?: Json; error?: Json };

async function call(email: string, id: string, input: unknown): Promise<CallOut> {
  return (await restCall(env, email, id, input)) as CallOut;
}

function body(extra: Record<string, unknown> = {}) {
  return {
    note: '',
    itemIds: ['i1', 'i2'],
    numbers: [
      { number: 'SN-001', expiresOn: '2027-03-01', link: '' },
      { number: 'SN-002', expiresOn: '2027-09-01', link: 'https://sertifikat.test/2' },
    ],
    attachmentIds: [],
    ...extra,
  };
}

async function create(extra: Record<string, unknown> = {}, email = ADMIN): Promise<Json> {
  const result = await call(email, 'postels.save', body(extra));
  expect(result.ok).toBe(true);
  // Waktu maju agar `updatedAt` penyimpanan berikutnya selalu berbeda.
  env.clock.advance(1000);
  return result.data as Json;
}

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

describe('postels.list dan postels.get', () => {
  test('daftar kosong membawa tanggal WIB dan ambang bawaan', async () => {
    const result = await call(ADMIN, 'postels.list', null);
    expect(result).toEqual({ ok: true, data: { postels: [], today: '2026-11-11', soonDays: 90 } });
  });

  test('ringkasan mengikuti nomor Aktif; nama turunan dari semua item', async () => {
    const postel = await create();
    const list = (await call(VIEWER, 'postels.list', null)).data as Json;
    expect(list.postels).toHaveLength(1);
    const summary = list.postels[0];
    expect(summary).toEqual({
      id: postel.id,
      name: 'M5-200/400',
      itemCount: 2,
      activeNumber: 'SN-002',
      activeExpiresOn: '2027-09-01',
      condition: 'valid',
      daysLeft: daysUntil('2027-09-01', '2026-11-11'),
      oldNumberCount: 1,
      numbers: ['SN-001', 'SN-002'],
      models: ['M5-200', 'M5-400'],
      updatedAt: postel.updatedAt,
    });
  });

  test('catatan yang nomor Aktifnya segera habis atau kedaluwarsa berlabel sesuai', async () => {
    await seedPostel(env, {
      id: 'p-soon',
      itemIds: ['i1'],
      numbers: [{ number: 'S-1', expiresOn: '2026-12-01' }],
    });
    await seedPostel(env, {
      id: 'p-exp',
      itemIds: ['i2'],
      numbers: [
        { number: 'E-OLD', expiresOn: '2026-01-01' },
        { number: 'E-NEW', expiresOn: '2026-11-10' },
      ],
    });
    const list = (await call(VIEWER, 'postels.list', null)).data as Json;
    const byId = new Map<string, Json>(list.postels.map((p: Json) => [p.id, p]));
    expect(byId.get('p-soon')).toMatchObject({ condition: 'soon', daysLeft: 20 });
    expect(byId.get('p-exp')).toMatchObject({ condition: 'expired', daysLeft: -1 });
  });

  test('get memuat nomor berurut seq, peran, kondisi, item, today dan soonDays', async () => {
    const postel = await create({ note: 'Catatan uji' });
    const got = (await call(ADMIN, 'postels.get', { id: postel.id })).data as Json;
    expect(got).toMatchObject({
      id: postel.id,
      name: 'M5-200/400',
      note: 'Catatan uji',
      itemCount: 2,
      hiddenItemCount: 0,
      attachments: [],
      today: '2026-11-11',
      soonDays: 90,
      updatedBy: ADMIN,
    });
    expect(got.numbers.map((n: Json) => [n.number, n.role, n.condition])).toEqual([
      ['SN-001', 'old', 'valid'],
      ['SN-002', 'active', 'valid'],
    ]);
    expect(got.numbers[0].daysLeft).toBe(daysUntil('2027-03-01', '2026-11-11'));
    expect(got.numbers[1].link).toBe('https://sertifikat.test/2');
    expect(got.items.map((i: Json) => i.model)).toEqual(['M5-200', 'M5-400']);
  });

  test('pembaca tanpa hak item tidak melihat item, tetapi jumlah dan nama turunan tetap ada', async () => {
    const postel = await create();
    const got = (await call(VIEWER, 'postels.get', { id: postel.id })).data as Json;
    expect(got).toMatchObject({
      items: [],
      itemCount: 2,
      hiddenItemCount: 2,
      name: 'M5-200/400',
    });
  });

  test('get id tak dikenal = NOT_FOUND', async () => {
    const result = await call(VIEWER, 'postels.get', { id: 'tidak-ada' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  test('ETag get = updatedAt', async () => {
    const postel = await create();
    const response = await rest.get(`/postels/${postel.id}`, { email: VIEWER });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(`"${postel.updatedAt as string}"`);
  });
});

describe('postels.save: membuat', () => {
  test('POST 201 + Location + ETag; stiker Postel tepat satu; item tertaut; audit postel.create', async () => {
    const response = await rest.post('/postels', { email: EDITOR, body: body() });
    expect(response.status).toBe(201);
    const postel = await jsonOf(response);
    expect(response.headers.get('location')).toBe(`/api/v1/postels/${postel.id as string}`);
    expect(response.headers.get('etag')).toBe(`"${postel.updatedAt as string}"`);
    expect(postel.name).toBe('M5-200/400');
    expect((postel.numbers as Json[]).map((n) => [n.number, n.role])).toEqual([
      ['SN-001', 'old'],
      ['SN-002', 'active'],
    ]);

    const types = (await call(ADMIN, 'stickerTypes.list', null)).data as Json[];
    const postelTypes = types.filter((t) => t.systemKind === 'postel');
    expect(postelTypes).toHaveLength(1);
    const stickers = ((await call(ADMIN, 'stickers.list', null)).data as Json[]).filter(
      (s) => s.typeId === postelTypes[0].id,
    );
    expect(stickers.map((s) => s.name)).toEqual(['Postel']);

    expect(
      (await rows('SELECT id FROM items WHERE postel_id = ? ORDER BY id', postel.id)).map(
        (r) => r.id,
      ),
    ).toEqual(['i1', 'i2']);
    const audit = await rows('SELECT action, target, actor, `after` FROM audit_log');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'postel.create',
      target: `postel:${postel.id as string}`,
      actor: EDITOR,
    });
    expect(JSON.parse(audit[0].after)).toEqual({
      note: '',
      numbers: ['SN-001 | 2027-03-01 | ', 'SN-002 | 2027-09-01 | https://sertifikat.test/2'],
      items: 2,
      attachments: 0,
    });
  });

  test('menyimpan catatan kedua tidak membuat jenis atau stiker Postel baru', async () => {
    await create();
    await create({
      itemIds: ['i3'],
      numbers: [{ number: 'LAIN-1', expiresOn: '2027-01-01', link: '' }],
    });
    const types = (await call(ADMIN, 'stickerTypes.list', null)).data as Json[];
    expect(types.filter((t) => t.systemKind === 'postel')).toHaveLength(1);
    const count = (await rows("SELECT COUNT(*) AS n FROM stickers WHERE name = 'Postel'"))[0];
    expect(Number(count.n)).toBe(1);
  });

  test('simpan yang gagal validasi tidak membuat jenis Postel', async () => {
    const result = await call(ADMIN, 'postels.save', body({ itemIds: [] }));
    expect(result.ok).toBe(false);
    const types = (await call(ADMIN, 'stickerTypes.list', null)).data as Json[];
    expect(types.filter((t) => t.systemKind === 'postel')).toHaveLength(0);
  });
});

describe('postels.save: nomor', () => {
  test('menambah nomor ketiga menjadikan nomor kedua Lama', async () => {
    const postel = await create();
    const [n1, n2] = postel.numbers as Json[];
    const result = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        numbers: [
          { id: n1.id, number: n1.number, expiresOn: n1.expiresOn, link: n1.link },
          { id: n2.id, number: n2.number, expiresOn: n2.expiresOn, link: n2.link },
          { number: 'SN-003', expiresOn: '2028-01-01', link: '' },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    const numbers = (result.data as Json).numbers as Json[];
    expect(numbers.map((n) => [n.number, n.role])).toEqual([
      ['SN-001', 'old'],
      ['SN-002', 'old'],
      ['SN-003', 'active'],
    ]);
    expect(numbers[0].id).toBe(n1.id);
    const audit = await rows('SELECT action, target FROM audit_log ORDER BY id');
    expect(audit.map((a) => a.action)).toEqual(['postel.create', 'postel.update']);
    expect(audit[1].target).toBe(`postel:${postel.id as string}`);
  });

  test('beberapa nomor baru mendapat seq berurutan menurut urutan larik', async () => {
    const postel = await create();
    const [n1, n2] = postel.numbers as Json[];
    const result = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        numbers: [
          { id: n1.id, number: n1.number, expiresOn: n1.expiresOn, link: n1.link },
          { id: n2.id, number: n2.number, expiresOn: n2.expiresOn, link: n2.link },
          { number: 'SN-003', expiresOn: '2028-01-01', link: '' },
          { number: 'SN-004', expiresOn: '2028-02-01', link: '' },
        ],
      }),
    });
    expect(
      (await rows('SELECT number, seq FROM postel_numbers ORDER BY seq')).map((r) => [
        r.number,
        Number(r.seq),
      ]),
    ).toEqual([
      ['SN-001', 1],
      ['SN-002', 2],
      ['SN-003', 3],
      ['SN-004', 4],
    ]);
    expect(((result.data as Json).numbers as Json[]).map((n) => n.role)).toEqual([
      'old',
      'old',
      'old',
      'active',
    ]);
  });

  test('mengubah tanggal habis mengosongkan state peringatan; mengubah hanya tautan tidak', async () => {
    await seedPostel(env, {
      id: 'p-a',
      itemIds: ['i1'],
      numbers: [
        {
          id: 'p-a-n1',
          number: 'A-1',
          expiresOn: '2027-03-01',
          alertSentThreshold: 90,
          alertSentOn: '2026-11-01',
        },
      ],
    });
    await seedPostel(env, {
      id: 'p-b',
      itemIds: ['i2'],
      numbers: [
        {
          id: 'p-b-n1',
          number: 'B-1',
          expiresOn: '2027-03-01',
          alertSentThreshold: 60,
          alertSentOn: '2026-11-02',
        },
      ],
    });
    const seeded = '2026-11-11T00:00:00.000Z';
    const changedDate = await call(ADMIN, 'postels.save', {
      id: 'p-a',
      expectedUpdatedAt: seeded,
      note: '',
      itemIds: ['i1'],
      numbers: [{ id: 'p-a-n1', number: 'A-1', expiresOn: '2027-04-01', link: '' }],
      attachmentIds: [],
    });
    expect(changedDate.ok).toBe(true);
    const changedLink = await call(ADMIN, 'postels.save', {
      id: 'p-b',
      expectedUpdatedAt: seeded,
      note: '',
      itemIds: ['i2'],
      numbers: [{ id: 'p-b-n1', number: 'B-1', expiresOn: '2027-03-01', link: 'https://x.test/b' }],
      attachmentIds: [],
    });
    expect(changedLink.ok).toBe(true);
    const a = (await rows("SELECT * FROM postel_numbers WHERE id = 'p-a-n1'"))[0];
    expect(a.alert_sent_threshold).toBeNull();
    expect(a.alert_sent_on).toBe('');
    expect(a.expires_on).toBe('2027-04-01');
    const b = (await rows("SELECT * FROM postel_numbers WHERE id = 'p-b-n1'"))[0];
    expect(Number(b.alert_sent_threshold)).toBe(60);
    expect(b.alert_sent_on).toBe('2026-11-02');
    expect(b.link).toBe('https://x.test/b');
  });

  test('menghapus nomor Lama berhasil; menghapus nomor Aktif ditolak', async () => {
    const postel = await create();
    const [n1, n2] = postel.numbers as Json[];
    const rejected = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        numbers: [{ id: n1.id, number: n1.number, expiresOn: n1.expiresOn, link: n1.link }],
      }),
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe('VALIDATION');
    expect(rejected.error?.fields?.numbers).toBe('Nomor Aktif tidak dapat dihapus');
    const removed = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        numbers: [{ id: n2.id, number: n2.number, expiresOn: n2.expiresOn, link: n2.link }],
      }),
    });
    expect(removed.ok).toBe(true);
    expect(((removed.data as Json).numbers as Json[]).map((n) => [n.number, n.role])).toEqual([
      ['SN-002', 'active'],
    ]);
    expect(await rows('SELECT id FROM postel_numbers')).toHaveLength(1);
  });

  test('menghapus nomor Lama sambil menambah nomor baru (nomor Aktif lama ikut dibuang) diizinkan', async () => {
    const postel = await create();
    const [n1] = postel.numbers as Json[];
    const result = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        numbers: [
          { id: n1.id, number: n1.number, expiresOn: n1.expiresOn, link: n1.link },
          { number: 'SN-009', expiresOn: '2028-05-01', link: '' },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect(((result.data as Json).numbers as Json[]).map((n) => [n.number, n.role])).toEqual([
      ['SN-001', 'old'],
      ['SN-009', 'active'],
    ]);
  });

  test('nomor yang sama (tanpa beda huruf besar) di dua catatan = CONFLICT pada number', async () => {
    await create({
      itemIds: ['i1'],
      numbers: [{ number: 'ab-1', expiresOn: '2027-01-01', link: '' }],
    });
    const second = await call(
      ADMIN,
      'postels.save',
      body({ itemIds: ['i2'], numbers: [{ number: 'AB-1', expiresOn: '2027-01-01', link: '' }] }),
    );
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe('CONFLICT');
    expect(second.error?.fields?.number).toBeTruthy();
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
    expect((await rows("SELECT id FROM items WHERE postel_id <> ''")).map((r) => r.id)).toEqual([
      'i1',
    ]);
  });

  test('nomor kembar di dalam masukan = VALIDATION pada numbers', async () => {
    const result = await call(
      ADMIN,
      'postels.save',
      body({
        numbers: [
          { number: 'ab-1', expiresOn: '2027-01-01', link: '' },
          { number: 'AB-1', expiresOn: '2027-02-01', link: '' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields?.numbers).toBeTruthy();
  });

  test('baris nomor dengan id milik catatan lain ditolak', async () => {
    const first = await create({
      itemIds: ['i1'],
      numbers: [{ number: 'X-1', expiresOn: '2027-01-01', link: '' }],
    });
    const second = await create({
      itemIds: ['i2'],
      numbers: [{ number: 'Y-1', expiresOn: '2027-01-01', link: '' }],
    });
    const result = await call(ADMIN, 'postels.save', {
      id: second.id,
      expectedUpdatedAt: second.updatedAt,
      ...body({
        itemIds: ['i2'],
        numbers: [
          {
            id: (first.numbers as Json[])[0].id,
            number: 'X-1',
            expiresOn: '2027-01-01',
            link: '',
          },
        ],
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields?.numbers).toBeTruthy();
  });

  test.each([
    ['tanggal tidak ada di kalender', { number: 'N', expiresOn: '2027-02-29', link: '' }],
    ['format tanggal salah', { number: 'N', expiresOn: '2027-2-1', link: '' }],
    ['tahun di luar rentang', { number: 'N', expiresOn: '2101-01-01', link: '' }],
    ['tautan ftp', { number: 'N', expiresOn: '2027-01-01', link: 'ftp://x' }],
    ['tautan tanpa skema', { number: 'N', expiresOn: '2027-01-01', link: 'sertifikat.test/a' }],
    ['nomor kosong', { number: '   ', expiresOn: '2027-01-01', link: '' }],
    ['nomor hanya simbol', { number: '---', expiresOn: '2027-01-01', link: '' }],
    ['nomor 101 karakter', { number: 'N'.repeat(101), expiresOn: '2027-01-01', link: '' }],
    [
      'tautan 2001 karakter',
      { number: 'N', expiresOn: '2027-01-01', link: `https://x.test/${'a'.repeat(2000)}` },
    ],
  ])('nomor tidak sah ditolak: %s', async (_name, row) => {
    const result = await call(ADMIN, 'postels.save', body({ numbers: [row] }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields?.numbers).toBeTruthy();
  });

  test.each([
    ['baris baru', 'SN-1\nBcc: x@y.co'],
    ['carriage return', 'SN-1\rX'],
    ['tab', 'SN-1\tX'],
    ['NUL', 'SN-1\u0000X'],
    ['DEL', 'SN-1\u007FX'],
    ['NEL', 'SN-1\u0085X'],
    ['pemisah baris Unicode', 'SN-1\u2028X'],
    ['pengatur arah teks (bidi)', 'SN-1\u202EX'],
  ])('nomor memuat karakter kontrol ditolak: %s', async (_name, number) => {
    const result = await call(
      ADMIN,
      'postels.save',
      body({ numbers: [{ number, expiresOn: '2027-01-01', link: '' }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields?.numbers).toBe(
      'Nomor 1: tidak boleh memuat karakter kontrol atau baris baru',
    );
    expect(await rows('SELECT id FROM postel_numbers')).toHaveLength(0);
  });

  test('nomor wajar (spasi, garis miring, titik, huruf berdiakritik) tetap diterima', async () => {
    const result = await call(
      ADMIN,
      'postels.save',
      body({ numbers: [{ number: 'SN/001.A 12 é', expiresOn: '2027-01-01', link: '' }] }),
    );
    expect(result.ok).toBe(true);
  });

  test('nomor kosong atau lebih dari 50 ditolak; 50 diterima', async () => {
    const empty = await call(ADMIN, 'postels.save', body({ numbers: [] }));
    expect(empty.error?.code).toBe('VALIDATION');
    expect(empty.error?.fields?.numbers).toBeTruthy();
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        number: `NO-${index}`,
        expiresOn: '2027-01-01',
        link: '',
      }));
    const over = await call(ADMIN, 'postels.save', body({ numbers: many(51) }));
    expect(over.error?.code).toBe('VALIDATION');
    expect(over.error?.fields?.numbers).toBeTruthy();
    const ok = await call(ADMIN, 'postels.save', body({ numbers: many(50) }));
    expect(ok.ok).toBe(true);
  });

  test('catatan lebih dari 1.000 karakter ditolak pada note', async () => {
    const result = await call(ADMIN, 'postels.save', body({ note: 'c'.repeat(1001) }));
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields?.note).toBeTruthy();
    expect((await call(ADMIN, 'postels.save', body({ note: 'c'.repeat(1000) }))).ok).toBe(true);
  });

  test('lampiran tak dikenal: attachmentIds ditolak', async () => {
    const result = await call(ADMIN, 'postels.save', body({ attachmentIds: ['f1'] }));
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields?.attachmentIds).toBeTruthy();
  });
});

describe('postels.save: item', () => {
  test('item milik catatan lain = CONFLICT pada itemIds dengan nomor Aktif pemilik', async () => {
    await seedPostel(env, {
      id: 'p-own',
      itemIds: ['i1'],
      numbers: [
        { number: 'OWN-OLD', expiresOn: '2027-01-01' },
        { number: 'OWN-NEW', expiresOn: '2027-06-01' },
      ],
    });
    const result = await call(ADMIN, 'postels.save', body({ itemIds: ['i1', 'i2'] }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CONFLICT');
    expect(result.error?.fields?.itemIds).toBe(
      'Item "PBE M5-400" sudah tergabung ke Postel "OWN-NEW"; keluarkan dulu dari sana',
    );
    // Tidak ada yang berubah.
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
    expect(
      (await rows('SELECT id FROM items WHERE postel_id IS NULL')).map((r) => r.id).sort(),
    ).toEqual(['i2', 'i3']);
  });

  test('item nonaktif baru ditolak; item nonaktif yang sudah terpasang boleh tetap', async () => {
    await seedItem(env, { id: 'i-off', brand: 'PBE', model: 'OFF-1', status: 'inactive' });
    const rejected = await call(ADMIN, 'postels.save', body({ itemIds: ['i1', 'i-off'] }));
    expect(rejected.error?.code).toBe('VALIDATION');
    expect(rejected.error?.fields?.itemIds).toContain('nonaktif');
    await seedPostel(env, {
      id: 'p-off',
      itemIds: ['i-off', 'i3'],
      numbers: [{ number: 'OFF-N', expiresOn: '2027-01-01' }],
    });
    const kept = await call(ADMIN, 'postels.save', {
      id: 'p-off',
      expectedUpdatedAt: '2026-11-11T00:00:00.000Z',
      ...body({
        note: 'diubah',
        itemIds: ['i-off', 'i3'],
        numbers: [{ id: 'p-off-n1', number: 'OFF-N', expiresOn: '2027-01-01', link: '' }],
      }),
    });
    expect(kept.ok).toBe(true);
  });

  test('itemIds kosong ditolak; item tak dikenal = "Item tidak ditemukan"; lebih dari 200 ditolak', async () => {
    const empty = await call(ADMIN, 'postels.save', body({ itemIds: [] }));
    expect(empty.error?.code).toBe('VALIDATION');
    expect(empty.error?.fields?.itemIds).toBeTruthy();
    const unknown = await call(ADMIN, 'postels.save', body({ itemIds: ['tidak-ada'] }));
    expect(unknown.error?.code).toBe('VALIDATION');
    expect(unknown.error?.fields?.itemIds).toBe('Item tidak ditemukan');
    const over = await call(
      ADMIN,
      'postels.save',
      body({ itemIds: Array.from({ length: 201 }, (_, index) => `x${index}`) }),
    );
    expect(over.error?.code).toBe('VALIDATION');
    expect(over.error?.fields?.itemIds).toBeTruthy();
  });

  test('item dikeluarkan dilepas; item yang dibuang dari daftar bebas dipakai catatan lain', async () => {
    const postel = await create();
    const [n1, n2] = postel.numbers as Json[];
    const result = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        itemIds: ['i1', 'i3'],
        numbers: [
          { id: n1.id, number: n1.number, expiresOn: n1.expiresOn, link: n1.link },
          { id: n2.id, number: n2.number, expiresOn: n2.expiresOn, link: n2.link },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect(
      (await rows('SELECT id FROM items WHERE postel_id = ? ORDER BY id', postel.id)).map(
        (r) => r.id,
      ),
    ).toEqual(['i1', 'i3']);
    expect((await rows("SELECT postel_id FROM items WHERE id = 'i2'"))[0].postel_id).toBeNull();
    expect((result.data as Json).name).toBe('M2-300/M5-400');
  });

  test('simpan tanpa perubahan tidak menaikkan updatedAt dan tidak menulis audit', async () => {
    const postel = await create();
    const [n1, n2] = postel.numbers as Json[];
    const result = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        numbers: [
          { id: n1.id, number: n1.number, expiresOn: n1.expiresOn, link: n1.link },
          { id: n2.id, number: n2.number, expiresOn: n2.expiresOn, link: n2.link },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect((result.data as Json).updatedAt).toBe(postel.updatedAt);
    expect(await rows('SELECT id FROM audit_log')).toHaveLength(1);
  });
});

describe('postels.save: versi usang', () => {
  test('expectedUpdatedAt usang = CONFLICT (stale) dan REST menjawab 412', async () => {
    const postel = await create();
    const [n1, n2] = postel.numbers as Json[];
    const next = body({
      note: 'versi baru',
      numbers: [
        { id: n1.id, number: n1.number, expiresOn: n1.expiresOn, link: n1.link },
        { id: n2.id, number: n2.number, expiresOn: n2.expiresOn, link: n2.link },
      ],
    });
    expect(
      (
        await call(ADMIN, 'postels.save', {
          id: postel.id,
          expectedUpdatedAt: postel.updatedAt,
          ...next,
        })
      ).ok,
    ).toBe(true);
    env.clock.advance(1000);
    const stale = await rest.put(`/postels/${postel.id as string}`, {
      email: ADMIN,
      headers: { 'if-match': `"${postel.updatedAt as string}"` },
      body: { ...next, note: 'versi usang' },
    });
    expect(stale.status).toBe(412);
    expect((await jsonOf(stale)).code).toBe('CONFLICT');
    const direct = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...next,
    });
    expect(direct.error?.code).toBe('CONFLICT');
    const row = (await rows('SELECT note FROM postels WHERE id = ?', postel.id))[0];
    expect(row.note).toBe('versi baru');
  });

  test('mengubah tanpa expectedUpdatedAt = VALIDATION; id tak dikenal = NOT_FOUND', async () => {
    const postel = await create();
    const missing = await call(ADMIN, 'postels.save', { id: postel.id, ...body() });
    expect(missing.error?.code).toBe('VALIDATION');
    const unknown = await call(ADMIN, 'postels.save', {
      id: 'tidak-ada',
      expectedUpdatedAt: postel.updatedAt,
      ...body(),
    });
    expect(unknown.error?.code).toBe('NOT_FOUND');
  });
});

describe('postels.save: item tak terlihat (BU)', () => {
  test('tanpa penugasan BU: itemOptions kosong dan memasang item = "Item tidak ditemukan"', async () => {
    const options = await call(NOBU, 'postels.itemOptions', {});
    expect(options).toEqual({ ok: true, data: { items: [], nextCursor: null } });
    const result = await call(NOBU, 'postels.save', body({ itemIds: ['i1'] }));
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields?.itemIds).toBe('Item tidak ditemukan');
  });

  test('item tak terlihat tetap terpasang; nomor dan catatan tetap dapat diubah; DTO tanpa identitas item', async () => {
    const postelId = await seedPostel(env, {
      id: 'p-hidden',
      itemIds: ['i1', 'i2'],
      numbers: [{ id: 'p-hidden-n1', number: 'H-1', expiresOn: '2027-01-01' }],
    });
    const seen = (await call(NOBU, 'postels.get', { id: postelId })).data as Json;
    expect(seen).toMatchObject({ items: [], itemCount: 2, hiddenItemCount: 2, name: 'M5-200/400' });
    const result = await call(NOBU, 'postels.save', {
      id: postelId,
      expectedUpdatedAt: '2026-11-11T00:00:00.000Z',
      note: 'diubah tanpa BU',
      itemIds: [],
      numbers: [
        { id: 'p-hidden-n1', number: 'H-1', expiresOn: '2027-02-01', link: '' },
        { number: 'H-2', expiresOn: '2027-12-01', link: '' },
      ],
      attachmentIds: [],
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      note: 'diubah tanpa BU',
      items: [],
      itemCount: 2,
      hiddenItemCount: 2,
    });
    expect(
      (await rows("SELECT id FROM items WHERE postel_id = 'p-hidden'")).map((r) => r.id).sort(),
    ).toEqual(['i1', 'i2']);
  });

  test('editor dengan BU: item di BU lain tidak terlihat dan tidak dapat dipasang', async () => {
    await seedBusinessUnit(env, { id: 'bu-lain', code: 'LAIN' });
    await seedItem(env, {
      id: 'i-lain',
      brand: 'PBE',
      model: 'LAIN-1',
      businessUnitIds: ['bu-lain'],
    });
    const result = await call(EDITOR, 'postels.save', body({ itemIds: ['i-lain'] }));
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields?.itemIds).toBe('Item tidak ditemukan');
    const options = (await call(EDITOR, 'postels.itemOptions', {})).data as Json;
    expect(options.items.map((i: Json) => i.id).sort()).toEqual(['i1', 'i2', 'i3']);
  });
});

describe('postels.remove', () => {
  test('melepas item, menghapus nomor, menulis audit; stiker Postel dan stok tetap', async () => {
    await seedLocation(env, { id: 'loc-1', code: 'WH' });
    const postel = await create({ note: 'akan dihapus' });
    const stickers = (await call(ADMIN, 'stickers.list', null)).data as Json[];
    const sticker = stickers.find((s) => s.name === 'Postel') as Json;
    const stock = await call(ADMIN, 'stickerStock.record', {
      locationId: 'loc-1',
      stickerId: sticker.id,
      kind: 'in',
      quantity: 5,
      reason: '',
    });
    expect(stock.ok).toBe(true);

    const response = await rest.del(`/postels/${postel.id as string}`, { email: EDITOR });
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(await rows('SELECT id FROM postels')).toHaveLength(0);
    expect(await rows('SELECT id FROM postel_numbers')).toHaveLength(0);
    expect(await rows("SELECT id FROM items WHERE postel_id <> ''")).toHaveLength(0);
    const audit = await rows(
      "SELECT target, actor, `before`, `after` FROM audit_log WHERE action = 'postel.delete'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ target: `postel:${postel.id as string}`, actor: EDITOR });
    expect(JSON.parse(audit[0].before).note).toBe('akan dihapus');
    expect(audit[0].after).toBe('null');
    expect(await rows("SELECT id FROM stickers WHERE name = 'Postel'")).toHaveLength(1);
    expect(await rows('SELECT id FROM sticker_stock_entries')).toHaveLength(1);
    // Item bebas dipakai lagi.
    expect(
      (
        await call(
          ADMIN,
          'postels.save',
          body({ numbers: [{ number: 'BARU-1', expiresOn: '2027-05-05', link: '' }] }),
        )
      ).ok,
    ).toBe(true);
  });

  test('id tak dikenal = NOT_FOUND; hapus dua kali = NOT_FOUND', async () => {
    const postel = await create();
    expect((await call(ADMIN, 'postels.remove', { id: postel.id })).ok).toBe(true);
    const again = await call(ADMIN, 'postels.remove', { id: postel.id });
    expect(again.error?.code).toBe('NOT_FOUND');
    expect((await call(ADMIN, 'postels.remove', { id: 'x' })).error?.code).toBe('NOT_FOUND');
  });
});

describe('postels.itemOptions', () => {
  test('hanya item aktif; menyertakan nomor Aktif pemilik; pencarian dan kursor', async () => {
    await seedItem(env, { id: 'i-off', brand: 'PBE', model: 'OFF-1', status: 'inactive' });
    await seedPostel(env, {
      id: 'p-opt',
      itemIds: ['i1'],
      numbers: [
        { number: 'OPT-OLD', expiresOn: '2027-01-01' },
        { number: 'OPT-NEW', expiresOn: '2027-06-01' },
      ],
    });
    const all = (await call(EDITOR, 'postels.itemOptions', {})).data as Json;
    expect(all.nextCursor).toBeNull();
    expect(all.items.map((i: Json) => [i.id, i.postelNumber])).toEqual([
      ['i3', ''],
      ['i2', ''],
      ['i1', 'OPT-NEW'],
    ]);
    expect(all.items[0]).toEqual({ id: 'i3', brand: 'PBE', model: 'M2-300', postelNumber: '' });
    const found = (await call(EDITOR, 'postels.itemOptions', { query: 'm5 200' })).data as Json;
    expect(found.items.map((i: Json) => i.id)).toEqual(['i2']);
    const first = (await call(EDITOR, 'postels.itemOptions', { limit: 2 })).data as Json;
    expect(first.items.map((i: Json) => i.id)).toEqual(['i3', 'i2']);
    expect(first.nextCursor).toBeTruthy();
    const second = (
      await call(EDITOR, 'postels.itemOptions', { limit: 2, cursor: first.nextCursor })
    ).data as Json;
    expect(second.items.map((i: Json) => i.id)).toEqual(['i1']);
    expect(second.nextCursor).toBeNull();
  });

  test('parameter tidak sah ditolak', async () => {
    expect((await call(EDITOR, 'postels.itemOptions', { limit: 0 })).error?.code).toBe(
      'VALIDATION',
    );
    expect((await call(EDITOR, 'postels.itemOptions', { limit: 51 })).error?.code).toBe(
      'VALIDATION',
    );
  });
});

describe('izin', () => {
  test('stickerview boleh list dan get; save, remove, itemOptions = 403', async () => {
    const postel = await create();
    expect((await call(VIEWER, 'postels.list', null)).ok).toBe(true);
    expect((await call(VIEWER, 'postels.get', { id: postel.id })).ok).toBe(true);
    for (const [method, input] of [
      [
        'postels.save',
        body({ itemIds: ['i3'], numbers: [{ number: 'V-1', expiresOn: '2027-01-01', link: '' }] }),
      ],
      ['postels.remove', { id: postel.id }],
      ['postels.itemOptions', {}],
    ] as const) {
      const result = await call(VIEWER, method, input);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('FORBIDDEN');
    }
    expect((await rest.post('/postels', { email: VIEWER, body: body() })).status).toBe(403);
    expect((await rest.del(`/postels/${postel.id as string}`, { email: VIEWER })).status).toBe(403);
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
  });

  test('pengguna tanpa sticker view = 403 di semua rute; tanpa sesi = 401', async () => {
    const postel = await create();
    for (const [method, input] of [
      ['postels.list', null],
      ['postels.get', { id: postel.id }],
      ['postels.itemOptions', {}],
      ['postels.remove', { id: postel.id }],
    ] as const) {
      expect((await call(NOSTICKER, method, input)).error?.code).toBe('FORBIDDEN');
    }
    expect((await rest.get('/postels', { email: null })).status).toBe(401);
  });
});

describe('postelSoonDays', () => {
  test('bawaan 90 bila pengaturan belum ada; ambang terbesar dari POSTEL_ALERT', async () => {
    expect(await postelSoonDays(env)).toBe(Math.max(...POSTEL_ALERT_DEFAULTS.thresholds));
    await putSetting(
      env,
      'POSTEL_ALERT',
      JSON.stringify({ ...POSTEL_ALERT_DEFAULTS, thresholds: [30, 120, 60] }),
    );
    expect(await postelSoonDays(env)).toBe(120);
    const list = (await call(VIEWER, 'postels.list', null)).data as Json;
    expect(list.soonDays).toBe(120);
  });

  test('pengaturan rusak atau tak lengkap memakai bawaan', async () => {
    for (const raw of ['bukan json', '{}', '{"thresholds":[]}', '{"thresholds":"90"}', 'null']) {
      await putSetting(env, 'POSTEL_ALERT', raw);
      expect(await postelSoonDays(env)).toBe(90);
    }
  });

  test('kondisi Segera habis memakai ambang terbesar yang diatur', async () => {
    await putSetting(
      env,
      'POSTEL_ALERT',
      JSON.stringify({ ...POSTEL_ALERT_DEFAULTS, thresholds: [200] }),
    );
    const postel = await create();
    const got = (await call(VIEWER, 'postels.get', { id: postel.id })).data as Json;
    // 2027-03-01 berjarak 110 hari (<= 200): segera habis; 2027-09-01 berjarak 294 hari: berlaku.
    expect(got.numbers.map((n: Json) => n.condition)).toEqual(['soon', 'valid']);
  });
});

describe('postels.save: rantai dan tukar nomor dalam satu simpan', () => {
  const numberRows = async () =>
    (await rows('SELECT number, number_key, seq FROM postel_numbers ORDER BY seq')).map((r) => [
      r.number,
      r.number_key,
      Number(r.seq),
    ]);

  const threeNumbers = ['SN-A', 'SN-B', 'SN-C'].map((number) => ({
    number,
    expiresOn: '2027-03-01',
    link: '',
  }));

  /** `numbers`: [indeks baris tersimpan, nomor baru] menurut urutan masukan. */
  function edit(postel: Json, numbers: Array<[number, string]>) {
    const stored = postel.numbers as Json[];
    return {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        numbers: numbers.map(([index, number]) => ({
          id: stored[index].id,
          number,
          expiresOn: stored[index].expiresOn,
          link: stored[index].link,
        })),
      }),
    };
  }

  test('rantai tiga baris (A->B, B->C, C->D) berhasil', async () => {
    const postel = await create({ numbers: threeNumbers });
    const result = await call(
      ADMIN,
      'postels.save',
      edit(postel, [
        [0, 'SN-B'],
        [1, 'SN-C'],
        [2, 'SN-D'],
      ]),
    );
    expect(result.ok).toBe(true);
    expect(await numberRows()).toEqual([
      ['SN-B', 'sn b', 1],
      ['SN-C', 'sn c', 2],
      ['SN-D', 'sn d', 3],
    ]);
    expect(((result.data as Json).numbers as Json[]).map((n) => [n.id, n.role])).toEqual(
      (postel.numbers as Json[]).map((n, i) => [n.id, i === 2 ? 'active' : 'old']),
    );
    expect(await rows("SELECT id FROM postel_numbers WHERE number_key LIKE '#%'")).toHaveLength(0);
  });

  test('tukar dua baris berhasil', async () => {
    const postel = await create({
      numbers: ['SN-X', 'SN-Y'].map((number) => ({ number, expiresOn: '2027-03-01', link: '' })),
    });
    const result = await call(
      ADMIN,
      'postels.save',
      edit(postel, [
        [0, 'SN-Y'],
        [1, 'SN-X'],
      ]),
    );
    expect(result.ok).toBe(true);
    expect(await numberRows()).toEqual([
      ['SN-Y', 'sn y', 1],
      ['SN-X', 'sn x', 2],
    ]);
  });

  test('rantai bersama penghapusan nomor Lama dan nomor baru yang memakai kunci yang dilepas', async () => {
    const postel = await create({ numbers: threeNumbers });
    const stored = postel.numbers as Json[];
    const result = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        numbers: [
          // baris 0 dibuang (SN-A bebas), baris 1 B->A, baris 2 tetap C, baris baru memakai 'SN-B'
          { id: stored[1].id, number: 'SN-A', expiresOn: '2027-03-01', link: '' },
          { id: stored[2].id, number: 'SN-C', expiresOn: '2027-03-01', link: '' },
          { number: 'SN-B', expiresOn: '2028-01-01', link: '' },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect((await numberRows()).map((r) => r[0])).toEqual(['SN-A', 'SN-C', 'SN-B']);
  });

  test('nomor kembar sungguhan (dengan catatan lain) tetap CONFLICT dan tidak mengubah apa pun', async () => {
    await create({
      itemIds: ['i3'],
      numbers: [{ number: 'LAIN-1', expiresOn: '2027-03-01', link: '' }],
    });
    const postel = await create({
      numbers: ['SN-A', 'SN-B'].map((number) => ({ number, expiresOn: '2027-03-01', link: '' })),
    });
    const result = await call(
      ADMIN,
      'postels.save',
      edit(postel, [
        [0, 'SN-B'],
        [1, 'lain 1'],
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CONFLICT');
    expect(result.error?.fields?.number).toBeTruthy();
    expect(
      (await rows('SELECT number, number_key FROM postel_numbers ORDER BY number')).map((r) => [
        r.number,
        r.number_key,
      ]),
    ).toEqual([
      ['LAIN-1', 'lain 1'],
      ['SN-A', 'sn a'],
      ['SN-B', 'sn b'],
    ]);
  });

  test('ubah hanya tautan sesudah state peringatan diubah pihak lain tidak mengembalikan state lama; ubah tanggal mereset', async () => {
    const postel = await create({
      numbers: [{ number: 'SN-S', expiresOn: '2027-03-01', link: '' }],
      itemIds: ['i1'],
    });
    const [n1] = postel.numbers as Json[];
    await env.DB.prepare(
      "UPDATE postel_numbers SET alert_sent_threshold = 90, alert_sent_on = '2026-11-10' WHERE id = ?",
    )
      .bind(n1.id)
      .run();
    const linkOnly = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...body({
        itemIds: ['i1'],
        numbers: [{ id: n1.id, number: 'SN-S', expiresOn: '2027-03-01', link: 'https://x.test/s' }],
      }),
    });
    expect(linkOnly.ok).toBe(true);
    let row = (await rows('SELECT * FROM postel_numbers WHERE id = ?', n1.id))[0];
    expect(Number(row.alert_sent_threshold)).toBe(90);
    expect(row.alert_sent_on).toBe('2026-11-10');
    env.clock.advance(1000);
    const dateChange = await call(ADMIN, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: (linkOnly.data as Json).updatedAt,
      ...body({
        itemIds: ['i1'],
        numbers: [{ id: n1.id, number: 'SN-S', expiresOn: '2027-05-01', link: 'https://x.test/s' }],
      }),
    });
    expect(dateChange.ok).toBe(true);
    row = (await rows('SELECT * FROM postel_numbers WHERE id = ?', n1.id))[0];
    expect(row.alert_sent_threshold).toBeNull();
    expect(row.alert_sent_on).toBe('');
  });
});
