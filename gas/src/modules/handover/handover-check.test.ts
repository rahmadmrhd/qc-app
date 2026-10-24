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
const setDone = (email = 'qc@gmail.com') => call(email, 'handovers.setDone', ref);
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

test('setDone mencentang semua butir dan idempoten; done:false ditolak (tidak ada buka kembali)', () => {
  seed({
    checks: [{ text: 'A = 1', by: 'x@gmail.com', at: '2026-10-14T00:00:00.000Z', occurrence: 0 }],
  });
  const done = setDone();
  expect(done.data.status).toBe('done');
  expect(done.data.checklist.map((c: { by: string }) => c.by)).toEqual([
    'x@gmail.com',
    'qc@gmail.com',
  ]);
  expect(setDone().ok).toBe(true);
  const tolak = call('qc@gmail.com', 'handovers.setDone', { ...ref, done: false });
  expect(tolak.error.code).toBe('VALIDATION');
  expect(tolak.error.fields.done).toBeDefined();
  expect(listHandovers_()[0]?.checks).toHaveLength(2);
  expect(audits()).toEqual(['handover.done']);
});

test('setDone pada task tanpa butir mengisi completedAt dan statusnya Selesai', () => {
  seed({ note: 'tanpa checklist' });
  const done = setDone();
  expect(done.data).toMatchObject({
    status: 'done',
    completedAt: '2026-10-15T03:00:00.000Z',
    completedBy: 'qc@gmail.com',
  });
  expect(setDone().ok).toBe(true);
  expect(audits()).toEqual(['handover.done']);
});

test('setDone oleh WH ditolak FORBIDDEN dan pada task Dibatalkan ditolak', () => {
  seed();
  expect(setDone('wh@gmail.com').error.code).toBe('FORBIDDEN');
  seed({ id: 't2', number: 'ST-20261015-002', status: 'cancelled' });
  expect(
    call('qc@gmail.com', 'handovers.setDone', { id: 't2', locationId: ENV.locA }).error.code,
  ).toBe('CONFLICT');
});

test('reopen: hanya task Dibatalkan, centang tetap, audit handover.uncancel, izin manage', () => {
  seed({
    checks: [{ text: 'A = 1', by: 'x@gmail.com', at: '2026-10-14T00:00:00.000Z', occurrence: 0 }],
    status: 'cancelled',
  });
  expect(call('whedit@gmail.com', 'handovers.reopen', ref).error.code).toBe('FORBIDDEN');
  expect(call('qc@gmail.com', 'handovers.reopen', ref).error.code).toBe('FORBIDDEN');
  const reopened = call('wh@gmail.com', 'handovers.reopen', ref);
  expect(reopened.ok).toBe(true);
  expect(reopened.data.status).toBe('in_progress');
  expect(reopened.data.checklist[0]).toMatchObject({ checked: true, by: 'x@gmail.com' });
  expect(audits()).toEqual(['handover.uncancel']);
  // task yang tidak dibatalkan ditolak
  expect(call('wh@gmail.com', 'handovers.reopen', ref).error.code).toBe('CONFLICT');
  expect(
    call('wh@gmail.com', 'handovers.reopen', { id: 't1', locationId: ENV.locB }).error.code,
  ).toBe('FORBIDDEN');
});

test('setCheck: teks butir ter-escape/berentitas tetap cocok dengan teks kanonis', () => {
  seed({ note: '- [ ] RB\\_5009\\_X = 1 unit\n- [ ] Kabel UTP &amp; konektor = 2 pcs' });
  expect(setCheck(0, 'RB_5009_X = 1 unit', true).ok).toBe(true);
  expect(setCheck(0, 'RB\\_5009\\_X = 1 unit', true).ok).toBe(true);
  expect(setCheck(1, 'Kabel UTP & konektor = 2 pcs', true).ok).toBe(true);
  expect(listHandovers_()[0]?.checks.map((c) => c.text)).toEqual([
    'RB_5009_X = 1 unit',
    'Kabel UTP & konektor = 2 pcs',
  ]);
});

test('audit aksi non-catatan tidak memuat note penuh', () => {
  seed({ note: `- [ ] A = 1\n\n${'x'.repeat(2000)}` });
  setCheck(0, 'A = 1', true);
  setDone();
  for (const record of listAuditRecords_()) {
    expect(JSON.stringify(record.before ?? {})).not.toContain('xxxxxxxxxx');
    expect(JSON.stringify(record.after ?? {})).not.toContain('xxxxxxxxxx');
    expect(Object.keys((record.after ?? {}) as object)).not.toContain('note');
  }
});

test('cancel ditolak untuk task Selesai; cancel biasa oleh WH manage berhasil dan idempoten', () => {
  seed();
  setDone();
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
  call('wh@gmail.com', 'handovers.cancel', ref);
  call('wh@gmail.com', 'handovers.reopen', ref);
  setDone();
  const records = listAuditRecords_();
  expect(records.map((r) => r.action)).toEqual([
    'handover.check',
    'handover.uncheck',
    'handover.cancel',
    'handover.uncancel',
    'handover.done',
  ]);
  expect(records.map((r) => r.actor)).toEqual([
    'qc@gmail.com',
    'qc@gmail.com',
    'wh@gmail.com',
    'wh@gmail.com',
    'qc@gmail.com',
  ]);
  expect(records.every((r) => r.target === 'ST-20261015-001')).toBe(true);
});
