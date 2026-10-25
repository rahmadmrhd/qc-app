import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertBrand_ } from '@gas/modules/brand/repo';
import { insertFile_ } from '@gas/modules/files/repo';
import { insertItem_ } from '@gas/modules/item/repo';
import { saveItem_ } from '@gas/modules/item/service';
import { brand, item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { handleSync_ } from './handler';
import { validateSyncPull_ } from './pull';
import { getSyncRoutes_ } from './routes';

const TOKEN = 't0k3n'.repeat(8);
let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', SYNC_API_TOKEN: TOKEN },
  });
  setPlatform_(platform);
});

function pull(payload: unknown) {
  const result = handleSync_(
    JSON.stringify({ v: 1, method: 'sync.items.pull', token: TOKEN, payload }),
    getSyncRoutes_(),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data as {
    items: Array<Record<string, unknown>>;
    nextRev: number;
    hasMore: boolean;
  };
}

const file = (id: string, driveId: string) =>
  insertFile_({
    id,
    driveId,
    mime: 'image/png',
    size: 10,
    width: 1,
    height: 1,
    ownerType: 'item',
    ownerId: 'i1',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'seed',
  });

function seedRich() {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  file('f1', 'DRV1');
  file('f2', 'DRV2');
  file('f3', 'DRV3');
  insertItem_(
    item({
      id: 'i1',
      brand: 'Ubiquiti',
      model: 'ES 24',
      externalId: '12',
      syncRev: 1,
      attachments: ['f1'],
      stickers: [
        { name: 'Label', note: 'n', fileId: 'f2' },
        { name: 'G', note: '', fileId: null },
      ],
      accessories: [{ name: 'Kabel', qty: 2 }],
      detail: '![x](qcfile:f3) teks',
    }),
  );
}

test('bentuk kabel: merk dari tabel merk, id Drive, uid/id, active; field berat hanya bila diminta', () => {
  seedRich();
  expect(pull({}).items).toEqual([
    {
      uid: 'i1',
      id: '12',
      merk: 'Ubiquiti',
      tipe: 'ES 24',
      isCountryLock: false,
      images: ['DRV1'],
      active: true,
      rev: 1,
    },
  ]);
  const heavy = pull({ include: ['detail', 'stickers', 'accessories'] }).items[0];
  expect(heavy).toMatchObject({
    detail: '![x](drive:DRV3) teks',
    stickers: [
      { name: 'Label', note: 'n', image: 'DRV2' },
      { name: 'G', note: '', image: null },
    ],
    accessories: [{ name: 'Kabel', qty: 2 }],
  });
  const onlyDetail = pull({ include: ['detail'] }).items[0] ?? {};
  expect('stickers' in onlyDetail).toBe(false);
  expect('detail' in onlyDetail).toBe(true);
});

test('id MySQL kosong → null; nonaktif → active:false; rujukan berkas yang tak tercatat dibuang dari images', () => {
  insertBrand_(brand('A', { syncRev: 1 }));
  insertItem_(
    item({
      id: 'i1',
      brand: 'A',
      model: 'X',
      syncRev: 1,
      status: 'inactive',
      attachments: ['hilang'],
    }),
  );
  expect(pull({}).items[0]).toMatchObject({ id: null, active: false, images: [] });
});

test('halaman tepat sekali, urut rev, kursor benar, hasMore benar; sinceRev menyaring', () => {
  insertBrand_(brand('A', { syncRev: 1 }));
  for (let i = 1; i <= 5; i++)
    insertItem_(item({ id: `i${i}`, brand: 'A', model: `M${i}`, syncRev: i * 10 }));
  insertItem_(item({ id: 'lama', brand: 'A', model: 'Lama', syncRev: 0 })); // belum punya revisi: tidak ikut
  const seen: string[] = [];
  let since = 0;
  for (let guard = 0; guard < 10; guard++) {
    const page = pull({ sinceRev: since, limit: 2 });
    seen.push(...page.items.map((entry) => String(entry.uid)));
    since = page.nextRev;
    if (!page.hasMore) break;
  }
  expect(seen).toEqual(['i1', 'i2', 'i3', 'i4', 'i5']);
  expect(since).toBe(50);
  expect(pull({ sinceRev: 50 })).toEqual({ items: [], nextRev: 50, hasMore: false });
  expect(pull({ sinceRev: 20 }).items.map((entry) => entry.uid)).toEqual(['i3', 'i4', 'i5']);
});

test('FS11: ubah alias tidak muncul di pull berikutnya; ubah detail muncul', () => {
  const admin = loadUserContext_('admin@gmail.com');
  if (!admin) throw new Error('admin hilang');
  const base = {
    brand: 'Ubiquiti',
    model: 'X',
    isCountryLock: false,
    aliases: [],
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
  };
  const saved = saveItem_(base, admin);
  const first = pull({});
  expect(first.items.map((entry) => entry.uid)).toEqual([saved.id]);
  saveItem_({ ...base, id: saved.id, aliases: ['Alias Baru'] }, admin);
  expect(pull({ sinceRev: first.nextRev }).items).toEqual([]);
  saveItem_({ ...base, id: saved.id, aliases: ['Alias Baru'], detail: 'baru' }, admin);
  expect(pull({ sinceRev: first.nextRev }).items.map((entry) => entry.uid)).toEqual([saved.id]);
});

test('payload tidak sah → VALIDATION; limit dibatasi 50 bila include memuat detail', () => {
  for (const payload of [
    { sinceRev: -1 },
    { limit: 0 },
    { limit: 501 },
    { include: ['alias'] },
    { include: 'detail' },
    'x',
  ]) {
    const result = handleSync_(
      JSON.stringify({ v: 1, method: 'sync.items.pull', token: TOKEN, payload }),
      getSyncRoutes_(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  }
  const parsed = validateSyncPull_({ limit: 500, include: ['detail'] }, [
    'detail',
    'stickers',
    'accessories',
  ]);
  expect(parsed.limit).toBe(50);
  expect(validateSyncPull_({ limit: 500 }, ['detail']).limit).toBe(500);
});
