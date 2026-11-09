import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { StickerGuideDto, StickerGuidePageDto } from '@shared/contract';
import { GUIDE_LIMITS } from '@shared/stickers';

// Pustaka gambar stiker (3b-1): daftar, thumbnail, unggah, ganti nama, hapus, dan akses gambar penuh.

setDefaultTimeout(30_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const WEBP_THUMB = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x08, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4,
]);

interface SeedGuide {
  id: string;
  name?: string;
  email?: string;
  size?: number;
  createdAt?: string;
  thumb?: Uint8Array;
  thumbMime?: string;
  ownerType?: string;
}

/** Menyisipkan baris `files` (pemilik stickerguide) + baris pustaka langsung lewat SQL. */
async function seedGuide(guide: SeedGuide): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO files (id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by, status) VALUES (?, ?, 'image/png', ?, 800, 600, ?, ?, ?, ?, 'active')",
    ).bind(
      guide.id,
      `drive-${guide.id}`,
      guide.size ?? 1000,
      guide.ownerType ?? 'stickerguide',
      guide.id,
      guide.createdAt ?? '2026-11-10T00:00:00.000Z',
      guide.email ?? 'uploader@gmail.com',
    ),
    env.DB.prepare(
      'INSERT INTO sticker_guide_images (id, name, thumb_mime, thumb, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      guide.id,
      guide.name ?? guide.id,
      guide.thumbMime ?? 'image/webp',
      guide.thumb ?? WEBP_THUMB,
      guide.createdAt ?? '2026-11-10T00:00:00.000Z',
    ),
  ]);
}

async function list(query = '', email?: string | null): Promise<StickerGuidePageDto> {
  const response = await rest.get(`/sticker-guides${query}`, email === undefined ? {} : { email });
  expect(response.status).toBe(200);
  return (await response.json()) as StickerGuidePageDto;
}

const names = (page: StickerGuidePageDto) => page.items.map((item) => item.name);

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-10T00:00:00.000Z'));
  rest = restClient(env);
  await seedRole(env, { id: 'r-item-view', name: 'Lihat Item', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-item-edit', name: 'Edit Item', permissions: { item: 'edit' } });
  await seedRole(env, {
    id: 'r-item-manage',
    name: 'Kelola Item',
    permissions: { item: 'manage' },
  });
  await seedRole(env, { id: 'r-stk-view', name: 'Lihat Stiker', permissions: { sticker: 'view' } });
  await seedRole(env, { id: 'r-stk-edit', name: 'Edit Stiker', permissions: { sticker: 'edit' } });
  await seedUser(env, { id: 'u-iv', email: 'iv@gmail.com', roleIds: ['r-item-view'] });
  await seedUser(env, { id: 'u-ie', email: 'ie@gmail.com', roleIds: ['r-item-edit'] });
  await seedUser(env, { id: 'u-im', email: 'im@gmail.com', roleIds: ['r-item-manage'] });
  await seedUser(env, { id: 'u-sv', email: 'sv@gmail.com', roleIds: ['r-stk-view'] });
  await seedUser(env, { id: 'u-se', email: 'se@gmail.com', roleIds: ['r-stk-edit'] });
  await seedUser(env, { id: 'u-nol', email: 'nol@gmail.com' });
  await seedUser(env, {
    id: 'u-up',
    email: 'uploader@gmail.com',
    name: 'Budi Pengunggah',
    roleIds: ['r-item-edit'],
  });
});

describe('GET /sticker-guides: izin', () => {
  test('401 tanpa sesi, 403 tanpa izin, 200 untuk item:view saja dan sticker:view saja', async () => {
    expect((await rest.get('/sticker-guides', { email: null })).status).toBe(401);
    const forbidden = await rest.get('/sticker-guides', { email: 'nol@gmail.com' });
    expect(forbidden.status).toBe(403);
    expect(await jsonOf(forbidden)).toMatchObject({ code: 'FORBIDDEN' });
    expect((await rest.get('/sticker-guides', { email: 'iv@gmail.com' })).status).toBe(200);
    expect((await rest.get('/sticker-guides', { email: 'sv@gmail.com' })).status).toBe(200);
    // sticker:edit tanpa item:view juga lolos lewat tingkat view (level lebih tinggi mencakup view).
    expect((await rest.get('/sticker-guides', { email: 'se@gmail.com' })).status).toBe(200);
  });
});

describe('GET /sticker-guides: paginasi kunci', () => {
  test('limit=2 atas 5 baris: tiga halaman berurutan tanpa duplikat, lalu nextCursor null', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedGuide({
        id: `g${i}`,
        name: `Gambar ${i}`,
        createdAt: `2026-11-10T00:00:0${i}.000Z`,
      });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: StickerGuidePageDto = await list(
        `?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...names(page));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(['Gambar 5', 'Gambar 4', 'Gambar 3', 'Gambar 2', 'Gambar 1']);
  });

  test('halaman pas penuh tidak memberi kursor palsu (5 baris, limit=5)', async () => {
    for (let i = 1; i <= 5; i++)
      await seedGuide({ id: `g${i}`, createdAt: `2026-11-10T00:00:0${i}.000Z` });
    const page = await list('?limit=5');
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  test('unggahan baru di antara halaman tidak menggandakan atau melewatkan (newest)', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedGuide({
        id: `g${i}`,
        name: `Gambar ${i}`,
        createdAt: `2026-11-10T00:00:0${i}.000Z`,
      });
    }
    const first = await list('?limit=2');
    expect(names(first)).toEqual(['Gambar 5', 'Gambar 4']);
    // Baris baru yang paling baru disisipkan setelah halaman pertama dimuat.
    await seedGuide({ id: 'g6', name: 'Gambar 6', createdAt: '2026-11-10T00:00:09.000Z' });
    const second = await list(`?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`);
    expect(names(second)).toEqual(['Gambar 3', 'Gambar 2']);
    const third = await list(`?limit=2&cursor=${encodeURIComponent(second.nextCursor ?? '')}`);
    expect(names(third)).toEqual(['Gambar 1']);
    expect(third.nextCursor).toBeNull();
  });

  test('waktu sama dipecah id (tanpa lompatan): 4 baris waktu sama, limit=1', async () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      await seedGuide({ id, name: id, createdAt: '2026-11-10T00:00:00.000Z' });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const page: StickerGuidePageDto = await list(
        `?limit=1${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...names(page));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(['d', 'c', 'b', 'a']);
  });

  test('halaman kosong: items [] dan nextCursor null', async () => {
    expect(await list()).toEqual({ items: [], nextCursor: null });
  });

  test('limit di luar 1..pageMax = 422; bawaan pageDefault', async () => {
    expect((await rest.get('/sticker-guides?limit=0')).status).toBe(422);
    expect((await rest.get(`/sticker-guides?limit=${GUIDE_LIMITS.pageMax + 1}`)).status).toBe(422);
    expect((await rest.get('/sticker-guides?limit=1.5')).status).toBe(422);
    for (let i = 0; i < GUIDE_LIMITS.pageDefault + 2; i++) {
      await seedGuide({ id: `p${String(i).padStart(3, '0')}` });
    }
    const page = await list();
    expect(page.items).toHaveLength(GUIDE_LIMITS.pageDefault);
    expect(page.nextCursor).not.toBeNull();
  });

  test('kursor rusak, dari urutan lain, atau bertipe salah = diperlakukan sebagai tanpa kursor (halaman pertama)', async () => {
    for (let i = 1; i <= 3; i++) {
      await seedGuide({
        id: `g${i}`,
        name: `Gambar ${i}`,
        createdAt: `2026-11-10T00:00:0${i}.000Z`,
      });
    }
    const bad = await list(`?limit=2&cursor=${encodeURIComponent('###bukan-kursor')}`);
    expect(names(bad)).toEqual(['Gambar 3', 'Gambar 2']);
    const valid = await list('?limit=1&sort=nameAsc');
    // Kursor milik urutan nameAsc dipakai pada urutan newest: tidak sah.
    const mismatched = await list(
      `?limit=2&sort=newest&cursor=${encodeURIComponent(valid.nextCursor ?? '')}`,
    );
    expect(names(mismatched)).toEqual(['Gambar 3', 'Gambar 2']);
    for (const junk of ['', 'e30', 'W10', btoa('["x"]'), btoa('{"a":1}')]) {
      const page = await list(`?limit=2&cursor=${encodeURIComponent(junk)}`);
      expect(names(page)).toEqual(['Gambar 3', 'Gambar 2']);
    }
  });

  test('ganti nama saat menggulir (nameAsc) tidak merusak daftar atau menjatuhkan server', async () => {
    for (const name of ['a', 'b', 'c', 'd']) await seedGuide({ id: `g-${name}`, name });
    const first = await list('?sort=nameAsc&limit=2');
    expect(names(first)).toEqual(['a', 'b']);
    await env.DB.prepare("UPDATE sticker_guide_images SET name = 'zz' WHERE id = 'g-a'").run();
    const second = await list(
      `?sort=nameAsc&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    );
    expect(names(second)).toEqual(['c', 'd']);
  });
});

describe('GET /sticker-guides: urutan', () => {
  beforeEach(async () => {
    await seedGuide({ id: 'g1', name: 'Bravo', size: 300, createdAt: '2026-11-10T00:00:01.000Z' });
    await seedGuide({ id: 'g2', name: 'alfa', size: 100, createdAt: '2026-11-10T00:00:02.000Z' });
    await seedGuide({
      id: 'g3',
      name: 'Charlie',
      size: 200,
      createdAt: '2026-11-10T00:00:03.000Z',
    });
  });

  test.each([
    ['newest', ['Charlie', 'alfa', 'Bravo']],
    ['oldest', ['Bravo', 'alfa', 'Charlie']],
    ['nameAsc', ['alfa', 'Bravo', 'Charlie']],
    ['nameDesc', ['Charlie', 'Bravo', 'alfa']],
    ['sizeDesc', ['Bravo', 'Charlie', 'alfa']],
  ])('sort=%s', async (sort, expected) => {
    expect(names(await list(`?sort=${sort}`))).toEqual(expected);
    // Kursor halaman demi halaman menghasilkan urutan yang sama.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page: StickerGuidePageDto = await list(
        `?sort=${sort}&limit=1${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...names(page));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(expected);
  });

  test('sort tak dikenal = 422', async () => {
    expect((await rest.get('/sticker-guides?sort=acak')).status).toBe(422);
  });
});

describe('GET /sticker-guides: pencarian', () => {
  beforeEach(async () => {
    await seedGuide({ id: 'g1', name: 'Diskon 100% Hemat', createdAt: '2026-11-10T00:00:01.000Z' });
    await seedGuide({ id: 'g2', name: 'Diskon 100 Hemat', createdAt: '2026-11-10T00:00:02.000Z' });
    await seedGuide({ id: 'g3', name: 'a_b', createdAt: '2026-11-10T00:00:03.000Z' });
    await seedGuide({ id: 'g4', name: 'axb', createdAt: '2026-11-10T00:00:04.000Z' });
    await seedGuide({ id: 'g5', name: 'C:\\Foto\\Baru', createdAt: '2026-11-10T00:00:05.000Z' });
    await seedGuide({ id: 'g6', name: 'Kardus  Ganda 😀', createdAt: '2026-11-10T00:00:06.000Z' });
    await seedGuide({ id: 'g7', name: 'KARDUS besar', createdAt: '2026-11-10T00:00:07.000Z' });
  });

  const search = async (term: string) => names(await list(`?search=${encodeURIComponent(term)}`));

  test('% hanya cocok harfiah', async () => {
    expect(await search('100%')).toEqual(['Diskon 100% Hemat']);
    expect(await search('%')).toEqual(['Diskon 100% Hemat']);
  });

  test('_ hanya cocok harfiah (bukan satu karakter bebas)', async () => {
    expect(await search('a_b')).toEqual(['a_b']);
    expect(await search('_')).toEqual(['a_b']);
  });

  test('backslash hanya cocok harfiah', async () => {
    expect(await search('\\')).toEqual(['C:\\Foto\\Baru']);
    expect(await search('o\\b')).toEqual(['C:\\Foto\\Baru']);
  });

  test('tak peka huruf, spasi ganda, dan emoji', async () => {
    expect(await search('kardus')).toEqual(['KARDUS besar', 'Kardus  Ganda 😀']);
    expect(await search('Kardus  Ganda')).toEqual(['Kardus  Ganda 😀']);
    expect(await search('😀')).toEqual(['Kardus  Ganda 😀']);
  });

  test('pencarian kosong/spasi = tanpa filter; tanpa hasil = daftar kosong', async () => {
    expect((await list('?search=%20%20')).items).toHaveLength(7);
    expect(await list('?search=tidak-ada-yang-begini')).toEqual({ items: [], nextCursor: null });
  });

  test('pencarian lebih dari 120 karakter dipangkas (tidak galat)', async () => {
    const response = await rest.get(`/sticker-guides?search=${'x'.repeat(500)}`);
    expect(response.status).toBe(200);
  });
});

describe('GET /sticker-guides: filter mine dan unused', () => {
  test('mine = hanya unggahan pemanggil; unused = semua (belum ada penempatan di 3b-1)', async () => {
    await seedGuide({ id: 'g1', name: 'Milik Saya', email: 'iv@gmail.com' });
    await seedGuide({ id: 'g2', name: 'Orang Lain', email: 'uploader@gmail.com' });
    expect(names(await list('?mine=true', 'iv@gmail.com'))).toEqual(['Milik Saya']);
    expect(names(await list('?mine=false', 'iv@gmail.com')).sort()).toEqual([
      'Milik Saya',
      'Orang Lain',
    ]);
    expect(names(await list('?unused=true')).sort()).toEqual(['Milik Saya', 'Orang Lain']);
    expect(names(await list('?mine=true&unused=true', 'iv@gmail.com'))).toEqual(['Milik Saya']);
  });
});

describe('GET /sticker-guides: bentuk DTO', () => {
  test('tanpa email pengunggah; nama tampilan atau "Pengguna"; metadata dari files; hak per pemanggil', async () => {
    await seedGuide({ id: 'g1', name: 'Kardus', email: 'uploader@gmail.com', size: 4321 });
    await seedGuide({ id: 'g2', name: 'Tanpa Akun', email: 'hantu@gmail.com' });
    const viewer = await rest.get('/sticker-guides?sort=nameAsc', { email: 'iv@gmail.com' });
    const text = await viewer.text();
    expect(text).not.toContain('@gmail.com');
    const page = JSON.parse(text) as StickerGuidePageDto;
    expect(page.items[0]).toEqual({
      id: 'g1',
      name: 'Kardus',
      mime: 'image/png',
      size: 4321,
      width: 800,
      height: 600,
      uploadedBy: 'Budi Pengunggah',
      uploadedByMe: false,
      createdAt: '2026-11-10T00:00:00.000Z',
      usageCount: 0,
      canRename: false,
      canRemove: false,
    });
    expect(page.items[1]?.uploadedBy).toBe('Pengguna');

    const own = (await list('?sort=nameAsc', 'uploader@gmail.com')).items[0] as StickerGuideDto;
    expect(own).toMatchObject({ uploadedByMe: true, canRename: true, canRemove: true });
    const editor = (await list('?sort=nameAsc', 'ie@gmail.com')).items[0] as StickerGuideDto;
    expect(editor).toMatchObject({ uploadedByMe: false, canRename: false, canRemove: false });
    const manager = (await list('?sort=nameAsc', 'im@gmail.com')).items[0] as StickerGuideDto;
    expect(manager).toMatchObject({ canRename: true, canRemove: true });
    const stickerOnly = (await list('?sort=nameAsc', 'se@gmail.com')).items[0] as StickerGuideDto;
    expect(stickerOnly).toMatchObject({ canRename: false, canRemove: false });
  });

  test('uploader berizin sticker:edit tanpa item:edit tidak dapat mengganti nama/menghapus miliknya', async () => {
    await seedGuide({ id: 'g1', name: 'Milik se', email: 'se@gmail.com' });
    const item = (await list('', 'se@gmail.com')).items[0] as StickerGuideDto;
    expect(item).toMatchObject({ uploadedByMe: true, canRename: false, canRemove: false });
  });

  test('gambar bukan pemilik stickerguide atau berkas pending_delete tidak tampil', async () => {
    await seedGuide({ id: 'g1', name: 'Sah' });
    await seedGuide({ id: 'g2', name: 'Berkas Item', ownerType: 'item' });
    await seedGuide({ id: 'g3', name: 'Dihapus' });
    await env.DB.prepare("UPDATE files SET status = 'pending_delete' WHERE id = 'g3'").run();
    expect(names(await list())).toEqual(['Sah']);
  });
});

describe('GET /sticker-guides/{id}/thumbnail', () => {
  test('byte, Content-Type tetap, Cache-Control private + immutable, ETag id', async () => {
    await seedGuide({ id: 'g1' });
    const response = await rest.get('/sticker-guides/g1/thumbnail', { email: 'iv@gmail.com' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    const cacheControl = response.headers.get('cache-control') ?? '';
    expect(cacheControl).toContain('private');
    expect(cacheControl).toContain('immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WEBP_THUMB);
    expect((await rest.get('/sticker-guides/g1/thumbnail', { email: 'sv@gmail.com' })).status).toBe(
      200,
    );
  });

  test('thumbnail JPEG disajikan sebagai image/jpeg', async () => {
    await seedGuide({
      id: 'g1',
      thumb: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]),
      thumbMime: 'image/jpeg',
    });
    const response = await rest.get('/sticker-guides/g1/thumbnail');
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });

  test('401 tanpa sesi, 403 tanpa izin', async () => {
    await seedGuide({ id: 'g1' });
    expect((await rest.get('/sticker-guides/g1/thumbnail', { email: null })).status).toBe(401);
    expect(
      (await rest.get('/sticker-guides/g1/thumbnail', { email: 'nol@gmail.com' })).status,
    ).toBe(403);
  });

  test('id berkas item, logo QR, stiker, yatim, pending_delete, atau tak ada = 404', async () => {
    await seedGuide({ id: 'g-item', ownerType: 'item' });
    await seedGuide({ id: 'g-logo', ownerType: 'qrlogo' });
    await seedGuide({ id: 'g-sticker', ownerType: 'sticker' });
    await seedGuide({ id: 'g-del' });
    await env.DB.prepare("UPDATE files SET status = 'pending_delete' WHERE id = 'g-del'").run();
    // Berkas biasa tanpa baris pustaka juga tak boleh terbaca lewat rute thumbnail.
    await env.DB.prepare(
      "INSERT INTO files (id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by, status) VALUES ('f-plain', 'd-plain', 'image/png', 1, 1, 1, 'item', 'i1', '', 'x', 'active')",
    ).run();
    for (const id of ['g-item', 'g-logo', 'g-sticker', 'g-del', 'f-plain', 'tidak-ada']) {
      const response = await rest.get(`/sticker-guides/${id}/thumbnail`);
      expect(response.status, id).toBe(404);
    }
  });

  test('If-None-Match yang cocok dijawab 304', async () => {
    await seedGuide({ id: 'g1' });
    const response = await rest.get('/sticker-guides/g1/thumbnail', {
      headers: { 'if-none-match': '"g1"' },
    });
    expect(response.status).toBe(304);
  });
});

describe('tidak dibatasi BU', () => {
  test('pemegang item:view tanpa BU mana pun tetap membaca daftar dan thumbnail', async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'AA' });
    await seedRole(env, { id: 'r-bu-view', name: 'Lihat BU', permissions: { item: 'view' } });
    await seedUser(env, {
      id: 'u-bu',
      email: 'bu@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-bu-view'] }],
    });
    await seedGuide({ id: 'g1', name: 'Terbuka' });
    expect(names(await list('', 'bu@gmail.com'))).toEqual(['Terbuka']);
    expect((await rest.get('/sticker-guides/g1/thumbnail', { email: 'bu@gmail.com' })).status).toBe(
      200,
    );
  });
});
