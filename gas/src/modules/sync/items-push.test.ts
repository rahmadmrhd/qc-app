import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertBrand_, listBrands_ } from '@gas/modules/brand/repo';
import { listFiles_ } from '@gas/modules/files/repo';
import { ensureDriveFolder_ } from '@gas/modules/files/service';
import { insertItem_, listItems_ } from '@gas/modules/item/repo';
import { brand, item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { handleSync_ } from './handler';
import { getSyncRoutes_ } from './routes';
import { nextRev_ } from './state';

const TOKEN = 't0k3n'.repeat(8);
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
let platform: MemoryPlatform;
let folder: string;

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', SYNC_API_TOKEN: TOKEN },
    now: () => Date.parse('2026-10-15T00:00:00.000Z'),
  });
  setPlatform_(platform);
  folder = ensureDriveFolder_();
});

const drive = (name = 'a.png') => platform.driveCreateFile(folder, name, 'image/png', PNG);
function prime(resource: 'brands' | 'items', count: number): void {
  for (let i = 0; i < count; i++) nextRev_(resource);
}

function call(method: string, payload: unknown) {
  return handleSync_(JSON.stringify({ v: 1, method, token: TOKEN, payload }), getSyncRoutes_());
}
// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Entry = Record<string, any>;
const push = (items: unknown[], extra: Record<string, unknown> = {}) =>
  call('sync.items.push', { items, ...extra });
const results = (items: unknown[], extra: Record<string, unknown> = {}): Entry[] => {
  const out = push(items, extra);
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return (out.data as { results: Entry[] }).results;
};
const pull = (include: string[] = ['detail', 'stickers', 'accessories']): Entry[] => {
  const out = call('sync.items.pull', { include });
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return (out.data as { items: Entry[] }).items;
};
const audits = () => listAuditRecords_().map((r) => `${r.actor}|${r.action}`);

const BASE = { id: '12', merk: 'Ubiquiti', tipe: 'ES 24 250W', isCountryLock: false };

test('item baru: created, merk dibuat otomatis, dipetakan ke id MySQL, audit atas nama sync:desktop', () => {
  const [out] = results([{ ...BASE, isCountryLock: 'true' }]);
  expect(out).toMatchObject({ index: 0, status: 'created', rev: 1 });
  const stored = listItems_()[0];
  expect(stored).toMatchObject({
    model: 'ES 24 250W',
    externalId: '12',
    isCountryLock: true,
    status: 'active',
    aliases: [],
  });
  expect(listBrands_().map((b) => b.name)).toEqual(['Ubiquiti']);
  expect(audits()).toEqual(['sync:desktop|brand.create', 'sync:desktop|item.create']);
  expect(pull()[0]).toMatchObject({
    uid: out?.uid,
    id: '12',
    merk: 'Ubiquiti',
    tipe: 'ES 24 250W',
    isCountryLock: true,
  });
});

test('idempoten: push yang sama dua kali → unchanged, rev dan audit tidak bertambah', () => {
  const payload = [
    {
      ...BASE,
      detail: '## Judul',
      stickers: [{ name: 'Label', note: 'n', image: null }],
      accessories: [{ name: 'Kabel', qty: 1 }],
    },
  ];
  const [first] = results(payload);
  const auditCount = listAuditRecords_().length;
  const [second] = results(payload);
  expect(second).toMatchObject({ status: 'unchanged', uid: first?.uid, rev: first?.rev });
  expect(listAuditRecords_()).toHaveLength(auditCount);
});

test('gambar: id Drive didaftarkan otomatis, Markdown drive: disimpan sebagai qcfile: dan kembali sebagai drive: saat pull', () => {
  const [a, b, c] = [drive('a.png'), drive('b.png'), drive('c.png')];
  const [out] = results([
    {
      ...BASE,
      images: [a],
      stickers: [{ name: 'L', note: '', image: b }],
      detail: `Teks ![x](drive:${c}) lagi`,
    },
  ]);
  expect(out?.status).toBe('created');
  const rows = listFiles_();
  expect(rows).toHaveLength(3);
  expect(
    rows.every(
      (r) => r.ownerType === 'item' && r.ownerId === out?.uid && r.createdBy === 'sync:desktop',
    ),
  ).toBe(true);
  const stored = listItems_()[0];
  const fileOfC = rows.find((r) => r.driveId === c)?.id;
  expect(stored?.detail).toBe(`Teks ![x](qcfile:${fileOfC}) lagi`);
  expect(pull()[0]).toMatchObject({
    images: [a],
    stickers: [{ name: 'L', note: '', image: b }],
    detail: `Teks ![x](drive:${c}) lagi`,
  });
});

test('id Drive di luar folder atau tak ada → invalid per field; tidak ada item dibuat', () => {
  const other = platform.driveCreateFolder('Lain');
  const outside = platform.driveCreateFile(other, 'x.png', 'image/png', PNG);
  const [byImage, bySticker, byMd] = results([
    { ...BASE, images: [outside] },
    { ...BASE, id: '13', tipe: 'B', stickers: [{ name: 'L', image: 'tidak-ada' }] },
    { ...BASE, id: '14', tipe: 'C', detail: `![x](drive:${outside})` },
  ]);
  expect(byImage).toMatchObject({
    status: 'invalid',
    fields: { images: expect.stringContaining(outside) },
  });
  expect(bySticker?.fields).toHaveProperty('stickers');
  expect(byMd?.fields).toHaveProperty('detail');
  expect(listItems_()).toHaveLength(0);
  expect(listFiles_()).toHaveLength(0);
});

test('Markdown pada push: hanya drive:<id>; https, data, dan qcfile ditolak', () => {
  const ok = drive();
  const bad = [
    '![x](https://x.test/a.png)',
    '![x](data:image/png;base64,AAAA)',
    '![x](qcfile:abc)',
    '![x]()',
    'teks qcfile:abc',
  ];
  const out = results([
    { ...BASE, id: '1', tipe: 'ok', detail: `![x](drive:${ok}) dan [tautan](https://x.test)` },
    ...bad.map((detail, i) => ({ ...BASE, id: `${10 + i}`, tipe: `bad${i}`, detail })),
  ]);
  expect(out[0]?.status).toBe('created');
  for (const entry of out.slice(1))
    expect(entry).toMatchObject({ status: 'invalid', fields: { detail: expect.any(String) } });
  expect(listItems_()).toHaveLength(1);
});

test('semantik field: tidak dikirim = tidak diubah; [] dan "" menggantikan', () => {
  const img = drive();
  const first = results([
    {
      ...BASE,
      images: [img],
      detail: 'asli',
      stickers: [{ name: 'L', note: '', image: null }],
      accessories: [{ name: 'K', qty: 1 }],
    },
  ])[0];
  const uid = first?.uid as string;
  const [keep] = results([{ uid, tipe: 'ES 24 250W', baseRev: first?.rev }]);
  expect(keep?.status).toBe('unchanged');
  const [clear] = results([{ uid, images: [], detail: '', baseRev: first?.rev }]);
  expect(clear?.status).toBe('updated');
  const after = listItems_().find((i) => i.id === uid);
  expect(after).toMatchObject({ attachments: [], detail: '' });
  expect(after?.stickers).toHaveLength(1);
  expect(after?.accessories).toHaveLength(1);
});

test('alias item tidak berubah oleh push', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', aliases: ['ES24'], syncRev: 1 }));
  prime('items', 1);
  const [out] = results([{ uid: 'i1', detail: 'baru', baseRev: 1 }]);
  expect(out?.status).toBe('updated');
  expect(listItems_()[0]?.aliases).toEqual(['ES24']);
});

test('item baru wajib merk, tipe, dan isCountryLock; "true"/"false" diterima; id MySQL angka diterima', () => {
  const [missing, textBool, numeric, badBool] = results([
    { id: '1', detail: 'x' },
    { ...BASE, id: '2', tipe: 'A', isCountryLock: 'false' },
    { merk: 'Ubiquiti', tipe: 'B', isCountryLock: true, id: 3 },
    { ...BASE, id: '4', tipe: 'C', isCountryLock: 'mungkin' },
  ]);
  expect(missing).toMatchObject({
    status: 'invalid',
    fields: {
      merk: expect.any(String),
      tipe: expect.any(String),
      isCountryLock: expect.any(String),
    },
  });
  expect(textBool?.status).toBe('created');
  expect(numeric?.status).toBe('created');
  expect(listItems_().find((i) => i.model === 'B')?.externalId).toBe('3');
  expect(badBool).toMatchObject({
    status: 'invalid',
    fields: { isCountryLock: 'Harus true atau false' },
  });
});

test('konflik dua arah: baseRev basi + beda → conflict (current lengkap, audit); baseRev terkini/overwrite/nilai sama berhasil', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(
    item({
      id: 'i1',
      brand: 'Ubiquiti',
      model: 'ES 24',
      syncRev: 5,
      detail: 'server',
      accessories: [{ name: 'K', qty: 1 }],
    }),
  );
  prime('items', 5);
  const [stale] = results([{ uid: 'i1', detail: 'desktop', baseRev: 3 }]);
  expect(stale).toMatchObject({
    status: 'conflict',
    uid: 'i1',
    rev: 5,
    current: {
      uid: 'i1',
      merk: 'Ubiquiti',
      tipe: 'ES 24',
      detail: 'server',
      stickers: [],
      accessories: [{ name: 'K', qty: 1 }],
      active: true,
      rev: 5,
    },
  });
  expect(listItems_()[0]?.detail).toBe('server');
  expect(audits().at(-1)).toBe('sync:desktop|item.sync.conflict');
  expect(results([{ uid: 'i1', detail: 'desktop' }])[0]?.status).toBe('conflict'); // tanpa baseRev
  expect(results([{ uid: 'i1', detail: 'server', baseRev: 3 }])[0]?.status).toBe('unchanged'); // sama persis
  expect(
    results([{ uid: 'i1', detail: 'desktop', baseRev: 3 }], { overwrite: true })[0]?.status,
  ).toBe('updated');
  const rev = listItems_()[0]?.syncRev;
  expect(results([{ uid: 'i1', detail: 'lagi', baseRev: rev }])[0]?.status).toBe('updated');
});

test('pencocokan: uid, id MySQL, lalu merk+tipe ternormalisasi; pemetaan saja → updated tanpa kenaikan rev', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquiti', model: 'ES-24 250W', syncRev: 4 }));
  const [mapped] = results([
    { id: '7', merk: 'UBIQUITI', tipe: 'ES-24 250W', isCountryLock: false },
  ]);
  expect(mapped).toMatchObject({ status: 'updated', uid: 'i1', rev: 4 });
  expect(listItems_()[0]).toMatchObject({ externalId: '7', syncRev: 4 });
  expect(results([{ id: '7', merk: 'Ubiquiti', tipe: 'ES-24 250W' }])[0]).toMatchObject({
    status: 'unchanged',
    uid: 'i1',
  });
  expect(results([{ uid: 'i1', id: '8' }])[0]).toMatchObject({
    status: 'conflict',
    fields: { id: expect.any(String) },
  });
  insertItem_(item({ id: 'i2', brand: 'Ubiquiti', model: 'Lain', externalId: '9', syncRev: 6 }));
  expect(results([{ uid: 'i1', id: '9' }])[0]?.status).toBe('conflict');
  expect(results([{ uid: 'tidak-ada' }])[0]).toMatchObject({
    status: 'invalid',
    fields: { uid: expect.any(String) },
  });
});

test('nonaktifkan lewat active:false; rev naik; audit item.deactivate', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', syncRev: 3 }));
  prime('items', 3);
  const [out] = results([{ uid: 'i1', active: false, baseRev: 3 }]);
  expect(out?.status).toBe('updated');
  expect(out?.rev).toBe(4);
  expect(pull([])[0]).toMatchObject({ active: false, rev: 4 });
  expect(audits().at(-1)).toBe('sync:desktop|item.deactivate');
});

test('isolasi: entri tidak sah, bentrok nama, dan sehat bercampur; urutan hasil = urutan permintaan', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(
    item({ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', aliases: ['Ubiquiti AF 5'], syncRev: 1 }),
  );
  const out = results([
    { ...BASE, id: '1', tipe: 'Sehat 1' },
    'bukan objek',
    { ...BASE, id: '2', tipe: 'AF 5' }, // kunci merk+tipe sama dengan nama lain item lain
    { ...BASE, id: '3', merk: '!!!' },
    { ...BASE, id: '4', tipe: 'Sehat 2' },
  ]);
  expect(out.map((r) => r.status)).toEqual(['created', 'invalid', 'invalid', 'invalid', 'created']);
  expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
  expect(out[2]?.fields).toHaveProperty('tipe');
  expect(
    listItems_()
      .map((i) => i.model)
      .sort(),
  ).toEqual(['ES 24', 'Sehat 1', 'Sehat 2']);
});

test('batas jumlah entri dan bentuk payload', () => {
  const many = Array.from({ length: 51 }, (_, i) => ({ ...BASE, id: String(i), tipe: `T${i}` }));
  expect(push(many)).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION', fields: { items: 'Maksimal 50 item' } },
  });
  const withDetail = Array.from({ length: 26 }, (_, i) => ({
    ...BASE,
    id: String(i),
    tipe: `T${i}`,
    detail: 'x',
  }));
  expect(push(withDetail)).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION', fields: { items: 'Maksimal 25 item' } },
  });
  expect(push([])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(call('sync.items.push', { items: 'x' })).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION' },
  });
  expect(call('sync.items.push', null)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
});

test('batas isi: detail > 20.000, stiker/kelengkapan tak sah, gambar > 10', () => {
  const [longDetail, badSticker, badQty, tooManyImages] = results([
    { ...BASE, id: '1', tipe: 'A', detail: 'x'.repeat(20_001) },
    { ...BASE, id: '2', tipe: 'B', stickers: [{ name: '' }] },
    { ...BASE, id: '3', tipe: 'C', accessories: [{ name: 'K', qty: 1.5 }] },
    { ...BASE, id: '4', tipe: 'D', images: Array.from({ length: 11 }, (_, i) => `d${i}`) },
  ]);
  expect(longDetail?.fields).toHaveProperty('detail');
  expect(badSticker?.fields).toHaveProperty('stickers');
  expect(badQty?.fields).toHaveProperty('accessories');
  expect(tooManyImages?.fields).toHaveProperty('images');
  expect(listItems_()).toHaveLength(0);
});

test('gambar Drive yang sama dipakai dua item, atau dipindah antar item, tidak ditolak', () => {
  const img = drive();
  const [a, b] = results([
    { ...BASE, id: '1', tipe: 'A', images: [img] },
    { ...BASE, id: '2', tipe: 'B', images: [img] },
  ]);
  expect(a?.status).toBe('created');
  expect(b?.status).toBe('created');
  expect(pull([]).map((entry) => entry.images)).toEqual([[img], [img]]);
  expect(listFiles_().filter((row) => row.driveId === img)).toHaveLength(2);
  // pindah: A melepas gambar, item baru C memakainya
  results([{ uid: a?.uid, images: [], baseRev: a?.rev }]);
  const [c] = results([{ ...BASE, id: '3', tipe: 'C', images: [img] }]);
  expect(c?.status).toBe('created');
});

test('berkas baru tidak didaftarkan bila entri akhirnya invalid atau konflik (tidak ada baris files yatim)', () => {
  const good = drive('good.png');
  const other = platform.driveCreateFolder('Lain');
  const outside = platform.driveCreateFile(other, 'x.png', 'image/png', PNG);
  const [mixed] = results([{ ...BASE, id: '1', tipe: 'Campur', images: [good, outside] }]);
  expect(mixed?.status).toBe('invalid');
  expect(listFiles_()).toHaveLength(0);

  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', syncRev: 5, detail: 'server' }));
  prime('items', 5);
  const [conflict] = results([{ uid: 'i1', images: [good], detail: 'desktop', baseRev: 3 }]);
  expect(conflict?.status).toBe('conflict');
  expect(listFiles_()).toHaveLength(0);
  expect(results([{ uid: 'i1', images: [good], baseRev: 5 }])[0]?.status).toBe('updated');
  expect(listFiles_()).toHaveLength(1);
});

test('tujuan gambar Markdown harus drive:<id> utuh (judul boleh); sisa seperti /sufiks ditolak', () => {
  const id = drive();
  const [ok, titled, suffix, query] = results([
    { ...BASE, id: '1', tipe: 'A', detail: `![x](drive:${id})` },
    { ...BASE, id: '2', tipe: 'B', detail: `![x](drive:${id} "judul")` },
    { ...BASE, id: '3', tipe: 'C', detail: `![x](drive:${id}/sufiks)` },
    { ...BASE, id: '4', tipe: 'D', detail: `![x](drive:${id}?a=1)` },
  ]);
  expect(ok?.status).toBe('created');
  expect(titled?.status).toBe('created');
  expect(suffix).toMatchObject({ status: 'invalid', fields: { detail: expect.any(String) } });
  expect(query?.status).toBe('invalid');
});

test('jumlah id Drive berbeda per item dibatasi (mencegah ribuan panggilan Drive)', () => {
  const many = Array.from({ length: 51 }, (_, i) => `![x](drive:ID${i})`).join(' ');
  const [out] = results([{ ...BASE, id: '1', tipe: 'Banyak', detail: many }]);
  expect(out).toMatchObject({
    status: 'invalid',
    fields: { detail: expect.stringContaining('50') },
  });
});

test('detail yang lolos batas di kabel tetapi melebihi 20.000 karakter setelah drive:→qcfile: ditolak per field, bukan tersimpan', () => {
  const c = drive();
  const ref = `![x](drive:${c})`;
  // Persis pada batas di kabel; penerjemahan ke qcfile:<uuid> membuatnya lebih panjang.
  const detail = `${ref}${'a'.repeat(20_000 - ref.length)}`;
  expect(detail.length).toBe(20_000);
  const [out] = results([{ ...BASE, id: '77', tipe: 'Panjang', detail }]);
  expect(out).toMatchObject({ status: 'invalid', fields: { detail: expect.any(String) } });
  expect(listItems_()).toHaveLength(0);
});

test('gambar Markdown gaya referensi dan bersarang ditolak (tidak lolos lewat tujuan di luar drive:)', () => {
  const ok = drive();
  const bad = [
    '![x][r]\n\n[r]: https://x.test/a.png',
    `![a ![b](drive:${ok})](https://x.test/a.png)`,
    '![x]',
    '![x](drive:abc',
  ];
  const out = results(
    bad.map((detail, i) => ({ ...BASE, id: `${30 + i}`, tipe: `ref${i}`, detail })),
  );
  for (const entry of out)
    expect(entry).toMatchObject({ status: 'invalid', fields: { detail: expect.any(String) } });
  expect(listItems_()).toHaveLength(0);
});

test('"drive:" di luar target gambar tidak diperiksa ke Drive dan tidak mengubah isi', () => {
  const [out] = results([
    { ...BASE, id: '40', tipe: 'Teks', detail: 'Lihat drive:tidak-ada dan [x](drive:juga-tidak)' },
  ]);
  expect(out).toMatchObject({ status: 'created' });
  expect(listItems_()[0]?.detail).toBe('Lihat drive:tidak-ada dan [x](drive:juga-tidak)');
});
