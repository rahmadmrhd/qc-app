import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertCustomer_ } from '@gas/modules/customer/repo';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { customer, handover, handoverLine } from '@gas-test/handover-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_, insertHandoverLine_, listHandoverLines_ } from './repo';

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => Date.parse('2026-10-15T03:00:00.000Z'),
    }),
  );
  seedHandoverEnv();
  insertCustomer_(customer('PT Maju'));
  insertHandover_(handover({ id: 't1', number: 'ST-20261015-001', locationId: ENV.locA }));
  insertHandoverLine_(handoverLine({ id: 'la', handoverId: 't1', itemId: ENV.itemA, qty: 5 }));
  insertHandoverLine_(
    handoverLine({
      id: 'lb',
      handoverId: 't1',
      itemId: ENV.itemB,
      itemLabel: 'Mikrotik hAP ac2',
      qty: 3,
    }),
  );
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) =>
  rpc(email, method, payload) as Result;
const ref = { id: 't1', locationId: ENV.locA };
const progress = (lineId: string, doneQty: unknown, email = 'qc@gmail.com') =>
  call(email, 'handovers.setProgress', { ...ref, lineId, doneQty });
const audits = () => listAuditRecords_().map((r) => r.action);
const doneOf = (lineId: string) => listHandoverLines_().find((l) => l.id === lineId)?.doneQty;

test('QC memperbarui qty selesai: baris, pelaku, waktu, status Dikerjakan, dan audit handover.progress', () => {
  const out = progress('la', 2);
  expect(out.ok).toBe(true);
  expect(out.data).toMatchObject({ status: 'in_progress', doneUnits: 2, totalUnits: 8 });
  const line = out.data.lines.find((l: { id: string }) => l.id === 'la');
  expect(line).toMatchObject({
    doneQty: 2,
    doneBy: 'qc@gmail.com',
    doneAt: '2026-10-15T03:00:00.000Z',
  });
  expect(audits()).toEqual(['handover.progress']);
  expect(listAuditRecords_().at(-1)).toMatchObject({
    actor: 'qc@gmail.com',
    target: 'ST-20261015-001 · Ubiquiti ES 24',
    before: { item: 'Ubiquiti ES 24', doneQty: 0, qty: 5 },
    after: { item: 'Ubiquiti ES 24', doneQty: 2, qty: 5 },
  });
});

test('batas qty selesai: bilangan bulat 0..target; pecahan, negatif, NaN, string, di atas target ditolak', () => {
  for (const bad of [-1, 1.5, Number.NaN, '2', null, 6, 100_001]) {
    expect(progress('la', bad).error.code).toBe('VALIDATION');
  }
  expect(progress('la', 6).error.fields.doneQty).toContain('0–5');
  expect(doneOf('la')).toBe(0);
  expect(progress('la', 5).ok).toBe(true);
  expect(progress('la', 0).ok).toBe(true); // dapat diturunkan kembali
  expect(progress('tidak-ada', 1).error.code).toBe('NOT_FOUND');
});

test('nilai yang sama tidak menulis dan tidak mengaudit', () => {
  expect(progress('la', 0).ok).toBe(true);
  expect(audits()).toEqual([]);
  progress('la', 2);
  progress('la', 2);
  expect(audits()).toEqual(['handover.progress']);
});

test('selesai per tipe mengisi qty = target; diulang tidak mengaudit lagi', () => {
  const out = call('qc@gmail.com', 'handovers.completeLine', { ...ref, lineId: 'lb' });
  expect(out.data.lines.find((l: { id: string }) => l.id === 'lb').doneQty).toBe(3);
  expect(out.data.status).toBe('in_progress');
  call('qc@gmail.com', 'handovers.completeLine', { ...ref, lineId: 'lb' });
  expect(audits()).toEqual(['handover.progress']);
});

test('task menjadi Selesai tepat saat baris terakhir penuh: satu handover.complete', () => {
  progress('la', 5);
  expect(audits()).toEqual(['handover.progress']);
  const last = progress('lb', 3);
  expect(last.data.status).toBe('done');
  expect(audits()).toEqual(['handover.progress', 'handover.progress', 'handover.complete']);
  expect(listAuditRecords_().at(-1)).toMatchObject({
    action: 'handover.complete',
    target: 'ST-20261015-001',
    before: { status: 'in_progress' },
    after: { status: 'done' },
  });
});

test('selesai per task: hanya baris yang belum penuh diisi; satu handover.complete; diulang → CONFLICT', () => {
  progress('la', 5);
  const out = call('qc@gmail.com', 'handovers.completeAll', ref);
  expect(out.data).toMatchObject({ status: 'done', doneUnits: 8, totalUnits: 8 });
  // Setiap baris yang diisi penuh meninggalkan jejak progres sendiri, lalu satu handover.complete.
  expect(audits()).toEqual(['handover.progress', 'handover.progress', 'handover.complete']);
  expect(doneOf('lb')).toBe(3);
  expect(call('qc@gmail.com', 'handovers.completeAll', ref).error.code).toBe('CONFLICT');
});

test('FQ6: task Selesai atau Dibatalkan tidak dapat diubah QC (CONFLICT dengan pesan jelas)', () => {
  call('qc@gmail.com', 'handovers.completeAll', ref);
  const done = progress('la', 1);
  expect(done.error).toMatchObject({
    code: 'CONFLICT',
    message: 'Task sudah selesai dan tidak dapat diubah',
  });
  expect(call('wh@gmail.com', 'handovers.cancel', ref).error.code).toBe('CONFLICT');

  insertHandover_(
    handover({ id: 'x', number: 'ST-20261015-002', locationId: ENV.locA, status: 'cancelled' }),
  );
  insertHandoverLine_(handoverLine({ id: 'lx', handoverId: 'x', itemId: ENV.itemA, qty: 2 }));
  const cancelled = call('qc@gmail.com', 'handovers.setProgress', {
    id: 'x',
    locationId: ENV.locA,
    lineId: 'lx',
    doneQty: 1,
  });
  expect(cancelled.error).toMatchObject({
    code: 'CONFLICT',
    message: 'Task sudah dibatalkan dan tidak dapat diubah',
  });
});

test('izin: WH (handover saja) dan viewer tidak bisa mengubah progres; QC bisa; lokasi lain/nonaktif ditolak', () => {
  for (const email of [
    'wh@gmail.com',
    'whedit@gmail.com',
    'viewer@gmail.com',
    'noaccess@gmail.com',
  ]) {
    expect(progress('la', 1, email).error.code).toBe('FORBIDDEN');
  }
  // qc@ punya qc edit di loc-b juga, tetapi task t1 milik loc-a → NOT_FOUND saat mengklaim loc-b
  const other = call('qc@gmail.com', 'handovers.setProgress', {
    id: 't1',
    locationId: ENV.locB,
    lineId: 'la',
    doneQty: 1,
  });
  expect(other.error.code).toBe('NOT_FOUND');
  expect(
    call('qc@gmail.com', 'handovers.setProgress', {
      id: 't1',
      locationId: ENV.locOff,
      lineId: 'la',
      doneQty: 1,
    }).error.code,
  ).toBe('FORBIDDEN');
  expect(
    call('qc@gmail.com', 'handovers.completeAll', { id: 't1', locationId: ENV.locB }).error.code,
  ).toBe('NOT_FOUND');
  expect(doneOf('la')).toBe(0);
});

test('baris milik task lain tidak dapat diubah lewat id task ini', () => {
  insertHandover_(handover({ id: 't2', number: 'ST-20261015-002', locationId: ENV.locA }));
  insertHandoverLine_(handoverLine({ id: 'lz', handoverId: 't2', itemId: ENV.itemA, qty: 4 }));
  expect(progress('lz', 1).error.code).toBe('NOT_FOUND');
  expect(doneOf('lz')).toBe(0);
});
