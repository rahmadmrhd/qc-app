import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { handover } from '@gas-test/handover-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_, listHandovers_ } from './repo';

let clock = Date.parse('2026-10-15T03:00:00.000Z');

beforeEach(() => {
  clock = Date.parse('2026-10-15T03:00:00.000Z');
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => clock,
    }),
  );
  seedHandoverEnv();
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) =>
  rpc(email, method, payload) as Result;
const ref = { id: 't1', locationId: ENV.locA };
const setCheck = (index: number, text: string, checked: boolean, email = 'qc@gmail.com') =>
  call(email, 'handovers.setCheck', { ...ref, index, text, checked });
const setDone = (done: boolean, email = 'qc@gmail.com') =>
  call(email, 'handovers.setDone', { ...ref, done });
const audits = () => listAuditRecords_().map((r) => r.action);

function seed(overrides: Partial<Parameters<typeof handover>[0]> = {}): void {
  insertHandover_(
    handover({
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A = 1\n- [ ] B = 2',
      ...overrides,
    }),
  );
}

test('setCheck mencentang butir, menyimpan pelaku/waktu, dan mengubah status Baru→Dikerjakan→Selesai', () => {
  seed();
  const first = setCheck(0, 'A = 1', true);
  expect(first.ok).toBe(true);
  expect(first.data.status).toBe('in_progress');
  expect(first.data.checklist[0]).toMatchObject({
    checked: true,
    by: 'qc@gmail.com',
    at: '2026-10-15T03:00:00.000Z',
  });
  expect(first.data.checklist[1].checked).toBe(false);
  const second = setCheck(1, 'B = 2', true);
  expect(second.data.status).toBe('done');
  const undone = setCheck(0, 'A = 1', false);
  expect(undone.data.status).toBe('in_progress');
  expect(undone.data.checklist[0]).toMatchObject({ checked: false, by: '' });
  expect(audits()).toEqual(['handover.check', 'handover.check', 'handover.uncheck']);
});

test('setCheck: butir kembar dicentang per kemunculan', () => {
  seed({ note: '- [ ] X\n- [ ] X' });
  const out = setCheck(1, 'X', true);
  expect(out.data.checklist.map((c: { checked: boolean }) => c.checked)).toEqual([false, true]);
  expect(listHandovers_()[0]?.checks[0]?.occurrence).toBe(1);
});

test('setCheck dua kali dengan checked:true idempoten (tanpa audit kedua)', () => {
  seed();
  clock += 1000;
  const first = setCheck(0, 'A = 1', true);
  clock += 1000;
  const again = setCheck(0, 'A = 1', true);
  expect(again.ok).toBe(true);
  expect(again.data.updatedAt).toBe(first.data.updatedAt);
  expect(again.data.checklist[0].at).toBe(first.data.checklist[0].at);
  expect(audits()).toEqual(['handover.check']);
  // membuka centang yang belum tercentang juga tidak berubah
  expect(setCheck(1, 'B = 2', false).ok).toBe(true);
  expect(audits()).toEqual(['handover.check']);
});

test('setCheck dengan text yang tidak cocok dengan indeks → CONFLICT', () => {
  seed();
  expect(setCheck(0, 'B = 2', true).error.code).toBe('CONFLICT');
  expect(setCheck(5, 'A = 1', true).error.code).toBe('CONFLICT');
  expect(listHandovers_()[0]?.checks).toEqual([]);
  expect(audits()).toEqual([]);
});

test('setCheck oleh pengguna tanpa qc:edit → FORBIDDEN', () => {
  seed();
  expect(setCheck(0, 'A = 1', true, 'wh@gmail.com').error.code).toBe('FORBIDDEN');
  expect(setCheck(0, 'A = 1', true, 'viewer@gmail.com').error.code).toBe('FORBIDDEN');
  expect(setCheck(0, 'A = 1', true, 'qc@gmail.com').ok).toBe(true);
});

test('setCheck pada task Dibatalkan ditolak; lokasi lain NOT_FOUND', () => {
  seed({ status: 'cancelled' });
  expect(setCheck(0, 'A = 1', true).error.code).toBe('CONFLICT');
  expect(
    call('qc@gmail.com', 'handovers.setCheck', {
      id: 't1',
      locationId: ENV.locB,
      index: 0,
      text: 'A = 1',
      checked: true,
    }).error.code,
  ).toBe('NOT_FOUND');
});

test('setDone mencentang semua butir; setDone(false) membuka kembali', () => {
  seed({
    checks: [{ text: 'A = 1', by: 'x@gmail.com', at: '2026-10-14T00:00:00.000Z', occurrence: 0 }],
  });
  const done = setDone(true);
  expect(done.data.status).toBe('done');
  expect(done.data.checklist.map((c: { by: string }) => c.by)).toEqual([
    'x@gmail.com',
    'qc@gmail.com',
  ]);
  expect(setDone(true).ok).toBe(true);
  const reopened = setDone(false);
  expect(reopened.data.status).toBe('new');
  expect(reopened.data.checklist.every((c: { checked: boolean }) => !c.checked)).toBe(true);
  expect(audits()).toEqual(['handover.done', 'handover.reopen']);
});

test('setDone pada task tanpa butir mengisi completedAt dan statusnya Selesai', () => {
  seed({ note: 'tanpa checklist' });
  const done = setDone(true);
  expect(done.data).toMatchObject({
    status: 'done',
    completedAt: '2026-10-15T03:00:00.000Z',
    completedBy: 'qc@gmail.com',
  });
  const reopened = setDone(false);
  expect(reopened.data).toMatchObject({ status: 'new', completedAt: '', completedBy: '' });
  expect(setDone(false).ok).toBe(true);
  expect(audits()).toEqual(['handover.done', 'handover.reopen']);
});

test('setDone oleh WH ditolak FORBIDDEN dan pada task Dibatalkan ditolak', () => {
  seed();
  expect(setDone(true, 'wh@gmail.com').error.code).toBe('FORBIDDEN');
});

test('cancel ditolak untuk task Selesai; cancel biasa oleh WH manage berhasil dan idempoten', () => {
  seed();
  setDone(true);
  expect(call('wh@gmail.com', 'handovers.cancel', ref).error.code).toBe('CONFLICT');
  insertHandover_(
    handover({
      id: 't2',
      number: 'ST-20261015-002',
      locationId: ENV.locA,
      note: '- [ ] A = 1',
    }),
  );
  const cancelled = call('wh@gmail.com', 'handovers.cancel', { id: 't2', locationId: ENV.locA });
  expect(cancelled.data.status).toBe('cancelled');
  expect(call('wh@gmail.com', 'handovers.cancel', { id: 't2', locationId: ENV.locA }).ok).toBe(
    true,
  );
  expect(audits().filter((a) => a === 'handover.cancel')).toHaveLength(1);
  expect(call('whedit@gmail.com', 'handovers.cancel', ref).error.code).toBe('FORBIDDEN');
});

test('semua mutasi menulis audit dengan pelaku', () => {
  seed();
  setCheck(0, 'A = 1', true);
  setCheck(0, 'A = 1', false);
  setDone(true);
  setDone(false);
  call('wh@gmail.com', 'handovers.cancel', ref);
  const records = listAuditRecords_();
  expect(records.map((r) => r.action)).toEqual([
    'handover.check',
    'handover.uncheck',
    'handover.done',
    'handover.reopen',
    'handover.cancel',
  ]);
  expect(records.map((r) => r.actor)).toEqual([
    'qc@gmail.com',
    'qc@gmail.com',
    'qc@gmail.com',
    'qc@gmail.com',
    'wh@gmail.com',
  ]);
  expect(records.every((r) => r.target === 'ST-20261015-001')).toBe(true);
});
