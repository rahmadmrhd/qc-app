import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { insertCustomer_ } from '@gas/modules/customer/repo';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { customer, handover } from '@gas-test/handover-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_ } from './repo';

let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
    now: () => Date.parse('2026-10-15T03:00:00.000Z'),
  });
  setPlatform_(platform);
  seedHandoverEnv();
  insertCustomer_(customer('PT Maju'));
  insertCustomer_(customer('Budi'));
  // loc-a: t1 (Baru), t2 (Dikerjakan), t3 (Selesai), t4 (Dibatalkan), t6 (Selesai tanpa checklist); loc-b: t5
  insertHandover_(
    handover({
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      note: '- [ ] A = 1\n- [ ] B = 2',
      createdAt: '2026-10-15T01:00:00.000Z',
    }),
  );
  insertHandover_(
    handover({
      id: 't2',
      number: 'ST-20261015-002',
      locationId: ENV.locA,
      note: '- [ ] A = 1\n- [ ] B = 2\n\nkirim sore',
      checks: [
        { text: 'A = 1', by: 'qc@gmail.com', at: '2026-10-15T02:10:00.000Z', occurrence: 0 },
      ],
      comments: [
        {
          id: 'c1',
          quote: 'kirim sore',
          before: '',
          after: '',
          body: 'ok',
          author: 'qc@gmail.com',
          at: 'x',
        },
        {
          id: 'c2',
          quote: 'hilang',
          before: '',
          after: '',
          body: 'usang',
          author: 'qc@gmail.com',
          at: 'x',
        },
      ],
      createdAt: '2026-10-15T02:00:00.000Z',
      customerId: 'cust-budi',
      customerName: 'Budi',
    }),
  );
  insertHandover_(
    handover({
      id: 't3',
      number: 'ST-20261014-001',
      locationId: ENV.locA,
      note: '- [ ] A = 1',
      checks: [{ text: 'A = 1', by: 'qc@gmail.com', at: 'x', occurrence: 0 }],
      createdAt: '2026-10-14T01:00:00.000Z',
    }),
  );
  insertHandover_(
    handover({
      id: 't4',
      number: 'ST-20261013-001',
      locationId: ENV.locA,
      note: '- [ ] A = 1',
      createdAt: '2026-10-13T01:00:00.000Z',
      status: 'cancelled',
    }),
  );
  insertHandover_(
    handover({
      id: 't6',
      number: 'ST-20261012-001',
      locationId: ENV.locA,
      note: 'tanpa checklist',
      completedAt: '2026-10-12T05:00:00.000Z',
      completedBy: 'qc@gmail.com',
      createdAt: '2026-10-12T01:00:00.000Z',
    }),
  );
  insertHandover_(
    handover({
      id: 't5',
      number: 'ST-20261015-003',
      locationId: ENV.locB,
      note: '- [ ] Z = 1',
      createdAt: '2026-10-15T02:30:00.000Z',
    }),
  );
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) =>
  rpc(email, method, payload) as Result;

test('board mengembalikan seluruh task lokasi dalam satu pembacaan, terbaru dahulu', () => {
  const sheet = platform.db.sheet('handovers');
  const before = sheet.calls;
  const out = call('wh@gmail.com', 'handovers.board', { locationIds: [ENV.locA] });
  expect(out.ok).toBe(true);
  expect(sheet.calls - before).toBeLessThanOrEqual(2);
  expect(out.data.map((t: { id: string }) => t.id)).toEqual(['t2', 't1', 't3', 't4', 't6']);
});

test('board menolak lokasi yang tidak boleh dibaca (FORBIDDEN) dan tidak membocorkan task lokasi lain', () => {
  const denied = call('wh@gmail.com', 'handovers.board', { locationIds: [ENV.locA, ENV.locB] });
  expect(denied.ok).toBe(false);
  expect(denied.error.code).toBe('FORBIDDEN');
  expect(JSON.stringify(denied)).not.toContain('ST-20261015-003');
  expect(
    call('noaccess@gmail.com', 'handovers.board', { locationIds: [ENV.locA] }).error.code,
  ).toBe('FORBIDDEN');
  const both = call('multi@gmail.com', 'handovers.board', { locationIds: [ENV.locA, ENV.locB] });
  expect(both.data.map((t: { id: string }) => t.id).sort()).toEqual([
    't1',
    't2',
    't3',
    't4',
    't5',
    't6',
  ]);
  const onlyB = call('multi@gmail.com', 'handovers.board', { locationIds: [ENV.locB] });
  expect(onlyB.data.map((t: { id: string }) => t.id)).toEqual(['t5']);
});

test('board mengisi checklist dari catatan beserta status centang dan status turunan', () => {
  const out = call('qc@gmail.com', 'handovers.board', { locationIds: [ENV.locA] });
  const byId = Object.fromEntries(out.data.map((t: { id: string }) => [t.id, t]));
  expect(byId.t1.status).toBe('new');
  expect(byId.t1.checklist).toEqual([
    { index: 0, text: 'A = 1', checked: false, by: '', at: '' },
    { index: 1, text: 'B = 2', checked: false, by: '', at: '' },
  ]);
  expect(byId.t2.status).toBe('in_progress');
  expect(byId.t2.checklist[0]).toMatchObject({ checked: true, by: 'qc@gmail.com' });
  expect(byId.t2.customerName).toBe('Budi');
  expect(byId.t3.status).toBe('done');
  expect(byId.t4.status).toBe('cancelled');
  expect(byId.t6.status).toBe('done');
  expect(byId.t6.checklist).toEqual([]);
});

test('komentar usang ditandai stale pada DTO', () => {
  const out = call('qc@gmail.com', 'handovers.get', { id: 't2', locationIds: [ENV.locA] });
  expect(out.data.comments.map((c: { id: string; stale: boolean }) => [c.id, c.stale])).toEqual([
    ['c1', false],
    ['c2', true],
  ]);
});

test('get: task lokasi lain NOT_FOUND; options berisi customer aktif dan nama nonaktif', () => {
  expect(
    call('wh@gmail.com', 'handovers.get', { id: 't5', locationIds: [ENV.locA] }).error.code,
  ).toBe('NOT_FOUND');
  insertCustomer_(customer('Lama', { status: 'inactive' }));
  const out = call('wh@gmail.com', 'handovers.options', { locationIds: [ENV.locA] });
  expect(out.data.customers.map((c: { name: string }) => c.name)).toEqual(['Budi', 'PT Maju']);
  expect(out.data.inactiveCustomerNames).toEqual(['Lama']);
  expect(out.data.items).toBeUndefined();
});
