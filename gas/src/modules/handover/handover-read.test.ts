import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { insertCustomer_ } from '@gas/modules/customer/repo';
import { getRoutes_ } from '@gas/routes';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { customer, handover, handoverLine } from '@gas-test/handover-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_, insertHandoverLine_ } from './repo';

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => Date.parse('2026-10-15T03:00:00.000Z'),
    }),
  );
  seedHandoverEnv();
  insertCustomer_(customer('PT Maju'));
  insertCustomer_(customer('Budi'));
  // loc-a: t1 (Baru), t2 (Dikerjakan), t3 (Selesai), t4 (Dibatalkan); loc-b: t5
  insertHandover_(
    handover({
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      createdAt: '2026-10-15T01:00:00.000Z',
    }),
  );
  insertHandoverLine_(handoverLine({ id: 'l1', handoverId: 't1', itemId: ENV.itemA, qty: 5 }));
  insertHandover_(
    handover({
      id: 't2',
      number: 'ST-20261015-002',
      locationId: ENV.locA,
      createdAt: '2026-10-15T02:00:00.000Z',
      customerId: 'cust-budi',
      customerName: 'Budi',
    }),
  );
  insertHandoverLine_(
    handoverLine({ id: 'l2', handoverId: 't2', itemId: ENV.itemA, qty: 5, doneQty: 2 }),
  );
  insertHandoverLine_(
    handoverLine({
      id: 'l3',
      handoverId: 't2',
      itemId: ENV.itemB,
      itemLabel: 'Mikrotik hAP ac2',
      qty: 3,
    }),
  );
  insertHandover_(
    handover({
      id: 't3',
      number: 'ST-20261014-001',
      locationId: ENV.locA,
      createdAt: '2026-10-14T01:00:00.000Z',
    }),
  );
  insertHandoverLine_(
    handoverLine({ id: 'l4', handoverId: 't3', itemId: ENV.itemA, qty: 2, doneQty: 2 }),
  );
  insertHandover_(
    handover({
      id: 't4',
      number: 'ST-20261013-001',
      locationId: ENV.locA,
      createdAt: '2026-10-13T01:00:00.000Z',
      status: 'cancelled',
    }),
  );
  insertHandoverLine_(
    handoverLine({ id: 'l5', handoverId: 't4', itemId: ENV.itemA, qty: 2, doneQty: 1 }),
  );
  insertHandover_(
    handover({
      id: 't5',
      number: 'ST-20261015-003',
      locationId: ENV.locB,
      createdAt: '2026-10-15T02:30:00.000Z',
    }),
  );
  insertHandoverLine_(
    handoverLine({
      id: 'l6',
      handoverId: 't5',
      itemId: ENV.itemB,
      itemLabel: 'Mikrotik hAP ac2',
      qty: 1,
    }),
  );
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) =>
  rpc(email, method, payload) as Result;

test('daftar: lokasi terpilih saja, terbaru dulu, status turunan dan ringkasan progres', () => {
  const out = call('wh@gmail.com', 'handovers.list', { locationIds: [ENV.locA] });
  expect(out.ok).toBe(true);
  expect(out.data.map((t: { id: string }) => t.id)).toEqual(['t2', 't1', 't3', 't4']);
  const byId = Object.fromEntries(out.data.map((t: { id: string }) => [t.id, t]));
  expect(byId.t1).toMatchObject({
    status: 'new',
    doneUnits: 0,
    totalUnits: 5,
    lineCount: 1,
    number: 'ST-20261015-001',
  });
  expect(byId.t2).toMatchObject({
    status: 'in_progress',
    doneUnits: 2,
    totalUnits: 8,
    lineCount: 2,
    customerName: 'Budi',
  });
  expect(byId.t3).toMatchObject({ status: 'done', doneUnits: 2, totalUnits: 2 });
  expect(byId.t4).toMatchObject({ status: 'cancelled' });
});

test('beberapa lokasi sekaligus; satu lokasi terlarang menolak seluruh permintaan', () => {
  const both = call('multi@gmail.com', 'handovers.list', { locationIds: [ENV.locA, ENV.locB] });
  expect(both.data.map((t: { id: string }) => t.id).sort()).toEqual(['t1', 't2', 't3', 't4', 't5']);
  expect(
    call('wh@gmail.com', 'handovers.list', { locationIds: [ENV.locA, ENV.locB] }).error.code,
  ).toBe('FORBIDDEN');
});

test('lokasi tak dikenal, nonaktif, dan user tanpa izin serah terima/QC → FORBIDDEN', () => {
  expect(call('wh@gmail.com', 'handovers.list', { locationIds: ['loc-zzz'] }).error.code).toBe(
    'FORBIDDEN',
  );
  expect(call('multi@gmail.com', 'handovers.list', { locationIds: [ENV.locOff] }).error.code).toBe(
    'FORBIDDEN',
  );
  expect(call('noaccess@gmail.com', 'handovers.list', { locationIds: [ENV.locA] }).error.code).toBe(
    'FORBIDDEN',
  );
});

test('"salah satu dari": handover view, handover manage, atau qc edit cukup; lokasi kosong ditolak', () => {
  for (const email of ['viewer@gmail.com', 'wh@gmail.com', 'qc@gmail.com']) {
    expect(call(email, 'handovers.list', { locationIds: [ENV.locA] }).ok).toBe(true);
  }
  expect(call('wh@gmail.com', 'handovers.list', { locationIds: [] }).error.code).toBe('VALIDATION');
  expect(call('wh@gmail.com', 'handovers.list', {}).error.code).toBe('VALIDATION');
});

test('detail: baris lengkap; id milik lokasi lain atau tak dikenal → NOT_FOUND walau user punya izin di lokasi yang diminta', () => {
  const ok = call('wh@gmail.com', 'handovers.get', { id: 't2', locationIds: [ENV.locA] });
  expect(ok.data).toMatchObject({ id: 't2', status: 'in_progress', createdBy: 'seed' });
  expect(ok.data.lines.map((l: { id: string }) => l.id)).toEqual(['l2', 'l3']);
  expect(ok.data.lines[0]).toMatchObject({
    itemId: ENV.itemA,
    itemLabel: 'Ubiquiti ES 24',
    qty: 5,
    doneQty: 2,
  });
  expect(
    call('qc@gmail.com', 'handovers.get', { id: 't5', locationIds: [ENV.locA] }).error.code,
  ).toBe('NOT_FOUND');
  expect(call('qc@gmail.com', 'handovers.get', { id: 't5', locationIds: [ENV.locB] }).ok).toBe(
    true,
  );
  expect(
    call('wh@gmail.com', 'handovers.get', { id: 'tidak-ada', locationIds: [ENV.locA] }).error.code,
  ).toBe('NOT_FOUND');
});

test('nama customer di daftar mengikuti nama terkini; salinan dipakai bila customer hilang', () => {
  const out = call('wh@gmail.com', 'handovers.list', { locationIds: [ENV.locA] });
  const t1 = out.data.find((t: { id: string }) => t.id === 't1');
  expect(t1.customerName).toBe('PT Maju');
  insertHandover_(
    handover({
      id: 't9',
      number: 'ST-20261015-009',
      locationId: ENV.locA,
      customerId: 'cust-hilang',
      customerName: 'Salinan Lama',
    }),
  );
  insertHandoverLine_(handoverLine({ id: 'l9', handoverId: 't9', itemId: ENV.itemA }));
  const again = call('wh@gmail.com', 'handovers.list', { locationIds: [ENV.locA] });
  expect(again.data.find((t: { id: string }) => t.id === 't9').customerName).toBe('Salinan Lama');
});

test('opsi form: item dan customer AKTIF saja, terurut, tanpa detail berat; izin serah terima cukup tanpa izin item', () => {
  insertCustomer_(customer('Lama', { status: 'inactive' }));
  const out = call('whedit@gmail.com', 'handovers.options', { locationIds: [ENV.locA] });
  expect(out.ok).toBe(true);
  expect(out.data.items.map((i: { id: string }) => i.id)).toEqual([ENV.itemB, ENV.itemA]); // Mikrotik, Ubiquiti
  expect(out.data.items[0]).toEqual({
    id: ENV.itemB,
    brand: 'Mikrotik',
    model: 'hAP ac2',
    aliases: ['hap'],
  });
  expect(out.data.customers.map((c: { name: string }) => c.name)).toEqual(['Budi', 'PT Maju']);
  expect(out.data.inactiveCustomerNames).toEqual(['Lama']);
  expect(JSON.stringify(out.data)).not.toContain('detail');
  expect(
    call('noaccess@gmail.com', 'handovers.options', { locationIds: [ENV.locA] }).error.code,
  ).toBe('FORBIDDEN');
});

test('izin rute baca: anyOf handover view atau qc edit, berlokasi', () => {
  const anyOf = {
    anyOf: [
      { module: 'handover', level: 'view', scope: 'location' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ],
  };
  const routes = getRoutes_();
  for (const method of ['handovers.options', 'handovers.list', 'handovers.get'] as const) {
    expect(routes[method].permission as unknown).toEqual(anyOf);
  }
});
