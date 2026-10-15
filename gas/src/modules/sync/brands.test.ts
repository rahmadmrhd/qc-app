import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertBrand_, listBrands_ } from '@gas/modules/brand/repo';
import { insertItem_, listItems_ } from '@gas/modules/item/repo';
import { brand, item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { handleSync_ } from './handler';
import { getSyncRoutes_ } from './routes';
import { nextRev_ } from './state';

const TOKEN = 't0k3n'.repeat(8);
let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', SYNC_API_TOKEN: TOKEN },
    now: () => Date.parse('2026-10-15T00:00:00.000Z'),
  });
  setPlatform_(platform);
});

/** Fixture memberi `syncRev` langsung; naikkan penghitung sync_state agar revisi baru selalu lebih besar. */
function prime(resource: 'brands' | 'items', count: number): void {
  for (let i = 0; i < count; i++) nextRev_(resource);
}

function call(method: string, payload: unknown) {
  const result = handleSync_(
    JSON.stringify({ v: 1, method, token: TOKEN, payload }),
    getSyncRoutes_(),
  );
  // biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
  return result as { ok: boolean; data?: any; error?: any };
}
const push = (brands: unknown[], extra: Record<string, unknown> = {}) =>
  call('sync.brands.push', { brands, ...extra });
const results = (brands: unknown[], extra: Record<string, unknown> = {}) => {
  const out = push(brands, extra);
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  // biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
  return out.data.results as Array<Record<string, any>>;
};
const lastAudit = () => {
  const record = listAuditRecords_().at(-1);
  if (!record) throw new Error('audit kosong');
  return record;
};

test('pull: halaman berurutan menurut rev, tepat sekali, kursor = rev terakhir; sinceRev menyaring', () => {
  for (let i = 1; i <= 5; i++)
    insertBrand_(brand(`Merk ${i}`, { syncRev: i * 10, externalId: i === 2 ? '77' : '' }));
  insertBrand_(brand('Lama', { syncRev: 0 })); // belum punya revisi: tidak ikut
  const seen: string[] = [];
  let since = 0;
  for (let guard = 0; guard < 10; guard++) {
    const page = call('sync.brands.pull', { sinceRev: since, limit: 2 });
    expect(page.ok).toBe(true);
    seen.push(...page.data.brands.map((b: { name: string }) => b.name));
    since = page.data.nextRev;
    if (!page.data.hasMore) break;
  }
  expect(seen).toEqual(['Merk 1', 'Merk 2', 'Merk 3', 'Merk 4', 'Merk 5']);
  expect(since).toBe(50);
  const one = call('sync.brands.pull', { sinceRev: 10, limit: 1 });
  expect(one.data.brands[0]).toEqual({
    uid: 'brand-merk-2',
    id: '77',
    name: 'Merk 2',
    active: true,
    rev: 20,
  });
  expect(call('sync.brands.pull', { sinceRev: 50 }).data).toEqual({
    brands: [],
    nextRev: 50,
    hasMore: false,
  });
  expect(call('sync.brands.pull', null).data.brands).toHaveLength(5);
});

test('pull: payload tidak sah → VALIDATION', () => {
  for (const payload of [
    { sinceRev: -1 },
    { sinceRev: 1.5 },
    { limit: 0 },
    { limit: 501 },
    { include: ['detail'] },
    'x',
  ]) {
    expect(call('sync.brands.pull', payload)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  }
});

test('push merk baru: created, dipetakan ke id MySQL, audit atas nama sync:desktop; diulang → unchanged', () => {
  const [first] = results([{ id: '3', name: 'Ubiquiti' }]);
  expect(first).toMatchObject({ index: 0, status: 'created', rev: 1 });
  expect(typeof first?.uid).toBe('string');
  expect(listBrands_()[0]).toMatchObject({
    name: 'Ubiquiti',
    externalId: '3',
    status: 'active',
    syncRev: 1,
  });
  expect(lastAudit()).toMatchObject({
    actor: 'sync:desktop',
    action: 'brand.create',
    target: 'Ubiquiti',
  });
  const auditCount = listAuditRecords_().length;
  const [again] = results([{ id: '3', name: 'Ubiquiti' }]);
  expect(again).toMatchObject({ status: 'unchanged', uid: first?.uid, rev: 1 });
  expect(listAuditRecords_()).toHaveLength(auditCount);
});

test('push mencocokkan menurut uid, lalu id MySQL, lalu nama ternormalisasi; pemetaan saja → updated tanpa kenaikan rev', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 5 }));
  const [mapped] = results([{ id: '3', name: 'ubiquiti' }]); // huruf berbeda = nilai sama
  expect(mapped).toMatchObject({ status: 'updated', uid: 'brand-ubiquiti', rev: 5 });
  expect(listBrands_()[0]).toMatchObject({ name: 'Ubiquiti', externalId: '3', syncRev: 5 });
  const [byId] = results([{ id: '3', name: 'Ubiquiti' }]);
  expect(byId).toMatchObject({ status: 'unchanged', uid: 'brand-ubiquiti' });
  const [byUid] = results([{ uid: 'brand-ubiquiti', active: true }]);
  expect(byUid?.status).toBe('unchanged');
});

test('ganti nama lewat push: updated, rev naik, kunci dan rev semua item merk itu ikut berubah, audit brand.update', () => {
  prime('brands', 5);
  prime('items', 8);
  insertBrand_(brand('Ubiquity', { syncRev: 5 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquity', model: 'ES 24', syncRev: 8 }));
  const [renamed] = results([{ uid: 'brand-ubiquity', name: 'Ubiquiti', baseRev: 5 }]);
  expect(renamed).toMatchObject({ status: 'updated' });
  expect((renamed?.rev ?? 0) > 5).toBe(true);
  expect(listItems_()[0]?.key).toBe('ubiquiti es 24');
  expect((listItems_()[0]?.syncRev ?? 0) > 8).toBe(true);
  expect(lastAudit()).toMatchObject({ actor: 'sync:desktop', action: 'brand.update' });
});

test('konflik: baseRev basi + nilai berbeda → conflict tanpa perubahan; baseRev terkini, overwrite, atau nilai sama berhasil', () => {
  prime('brands', 5);
  insertBrand_(brand('A', { syncRev: 5 }));
  const [stale] = results([{ uid: 'brand-a', name: 'B', baseRev: 3 }]);
  expect(stale).toMatchObject({
    status: 'conflict',
    uid: 'brand-a',
    rev: 5,
    current: { uid: 'brand-a', name: 'A', active: true, rev: 5 },
  });
  expect(listBrands_()[0]?.name).toBe('A');
  expect(lastAudit()).toMatchObject({ actor: 'sync:desktop', action: 'brand.sync.conflict' });
  expect(results([{ uid: 'brand-a', name: 'B' }])[0]?.status).toBe('conflict'); // tanpa baseRev
  expect(results([{ uid: 'brand-a', name: 'B', baseRev: 3 }], { overwrite: true })[0]?.status).toBe(
    'updated',
  );
  expect(listBrands_()[0]?.name).toBe('B');
  expect(
    results([{ uid: 'brand-a', name: 'C', baseRev: listBrands_()[0]?.syncRev }])[0]?.status,
  ).toBe('updated');
  expect(results([{ uid: 'brand-a', name: 'C', baseRev: 1 }])[0]?.status).toBe('unchanged'); // nilai sama, baseRev basi
});

test('nonaktifkan lewat active:false; pull menampilkan active:false', () => {
  prime('brands', 1);
  insertBrand_(brand('A', { syncRev: 1 }));
  const [off] = results([{ uid: 'brand-a', active: false, baseRev: 1 }]);
  expect(off?.status).toBe('updated');
  expect(listBrands_()[0]?.status).toBe('inactive');
  expect(call('sync.brands.pull', {}).data.brands[0]).toMatchObject({ active: false });
});

test('entri tidak sah menghasilkan invalid per field tanpa membatalkan entri lain; urutan hasil = urutan permintaan', () => {
  const out = results([
    { name: 'Valid 1' },
    { name: '' },
    { id: { x: 1 }, name: 'Y' },
    { uid: 'tidak-ada', name: 'Z' },
    { name: '!!!' },
    { active: true },
    'bukan objek',
    { name: 'Valid 2', id: 12 },
  ]);
  expect(out.map((r) => r.status)).toEqual([
    'created',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'created',
  ]);
  expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(out[1]?.fields).toEqual({ name: 'Wajib diisi' });
  expect(out[3]?.fields).toEqual({ uid: 'Merk tidak ditemukan' });
  expect(out[5]?.fields).toEqual({ name: 'Wajib diisi untuk merk baru' });
  expect(
    listBrands_()
      .map((b) => b.name)
      .sort(),
  ).toEqual(['Valid 1', 'Valid 2']);
  expect(listBrands_().find((b) => b.name === 'Valid 2')?.externalId).toBe('12');
});

test('uid dan id yang mengarah ke merk berbeda, atau merk sudah terpetakan ke id lain → conflict', () => {
  insertBrand_(brand('A', { externalId: '1', syncRev: 1 }));
  insertBrand_(brand('B', { externalId: '2', syncRev: 2 }));
  expect(results([{ uid: 'brand-a', id: '2' }])[0]?.status).toBe('conflict');
  expect(results([{ uid: 'brand-a', id: '9' }])[0]?.status).toBe('conflict');
  expect(listBrands_().map((b) => b.externalId)).toEqual(['1', '2']);
});

test('ganti nama ke nama merk lain → invalid (CONFLICT server dipetakan ke field name)', () => {
  insertBrand_(brand('A', { syncRev: 1 }));
  insertBrand_(brand('B', { syncRev: 2 }));
  const [out] = results([{ uid: 'brand-a', name: 'B', baseRev: 1 }]);
  expect(out).toMatchObject({ status: 'invalid', fields: { name: 'Nama merk sudah dipakai' } });
});

test('batas jumlah entri dan bentuk payload', () => {
  const many = Array.from({ length: 51 }, (_, i) => ({ name: `M${i}` }));
  expect(push(many)).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION', fields: { brands: 'Maksimal 50 merk' } },
  });
  expect(push([])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(call('sync.brands.push', { brands: 'x' })).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION' },
  });
  expect(call('sync.brands.push', { brands: [{ name: 'A' }], overwrite: 'ya' })).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION' },
  });
  expect(call('sync.brands.push', null)).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION' },
  });
});

test('push merk: field tidak dikenal ditolak per field', () => {
  const [out] = results([{ id: '1', name: 'Ubiquiti', nama: 'salah' }]);
  expect(out).toMatchObject({ status: 'invalid', fields: { nama: 'Field tidak dikenal' } });
});
