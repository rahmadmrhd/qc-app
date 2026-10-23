import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertCustomer_, listCustomers_ } from '@gas/modules/customer/repo';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { customer, handover } from '@gas-test/handover-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_, listHandovers_ } from './repo';

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => Date.parse('2026-10-15T03:00:00.000Z'),
    }),
  );
  seedHandoverEnv();
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) =>
  rpc(email, method, payload) as Result;
const save = (payload: Record<string, unknown>, email = 'wh@gmail.com') =>
  call(email, 'handovers.save', {
    locationId: ENV.locA,
    customerName: '',
    note: '',
    ...payload,
  });
const audits = () => listAuditRecords_().map((r) => r.action);
const checkA = { text: 'A', by: 'qc@gmail.com', at: '2026-10-15T02:00:00.000Z', occurrence: 0 };

function seedTask(overrides: Parameters<typeof handover>[0]): void {
  insertHandover_(handover({ customerId: '', customerName: '', ...overrides }));
}

test('save membuat task bernomor ST-YYYYMMDD-001 tanpa customer; catatan 5.000 karakter diterima, 5.001 ditolak', () => {
  const ok = save({ note: 'a'.repeat(5000) });
  expect(ok.ok).toBe(true);
  expect(ok.data).toMatchObject({
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    customerId: '',
    customerName: '',
    status: 'new',
    createdBy: 'wh@gmail.com',
  });
  expect(audits()).toEqual(['handover.create']);
  const bad = save({ note: 'a'.repeat(5001) });
  expect(bad.ok).toBe(false);
  expect(bad.error.code).toBe('VALIDATION');
  expect(bad.error.fields.note).toBeDefined();
  expect(save({ note: 'x' }).data.number).toBe('ST-20261015-002');
});

test('save dengan customer baru membuatnya dan mencatat audit customer.create sebelum handover.create', () => {
  const out = save({ customerName: 'PT Baru', note: '- [ ] A = 1' });
  expect(out.data.customerName).toBe('PT Baru');
  expect(audits()).toEqual(['customer.create', 'handover.create']);
});

test('save menormalkan "- [x]" menjadi tidak tercentang', () => {
  const out = save({ note: '- [x] A = 1\n- [X] B = 2' });
  expect(out.data.note).toBe('- [ ] A = 1\n- [ ] B = 2');
  expect(out.data.checklist.every((c: { checked: boolean }) => !c.checked)).toBe(true);
  expect(out.data.status).toBe('new');
});

test('save mengubah catatan: urutan ulang mempertahankan centang; edit butir tercentang mereset dan masuk audit; menghapus butir tercentang ditolak VALIDATION', () => {
  seedTask({
    id: 't1',
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    note: '- [ ] A\n- [ ] B',
    checks: [checkA],
  });
  // urutan ulang
  const reordered = save({ id: 't1', note: '- [ ] B\n- [ ] A' });
  expect(reordered.ok).toBe(true);
  expect(reordered.data.checklist).toEqual([
    { index: 0, text: 'B', checked: false, by: '', at: '' },
    { index: 1, text: 'A', checked: true, by: 'qc@gmail.com', at: checkA.at },
  ]);
  // edit butir tercentang mereset dan tercatat di audit
  const edited = save({ id: 't1', note: '- [ ] B\n- [ ] A2' });
  expect(edited.ok).toBe(true);
  expect(edited.data.checklist.every((c: { checked: boolean }) => !c.checked)).toBe(true);
  expect(edited.data.status).toBe('new');
  const audit = listAuditRecords_().at(-1);
  expect(audit?.action).toBe('handover.update');
  expect(audit?.after).toMatchObject({ resets: ['A → A2'] });
  expect(audit?.before).toMatchObject({ checked: ['A'], note: '- [ ] B\n- [ ] A' });
});

test('save: menghapus atau mengubah butir tercentang menjadi paragraf ditolak VALIDATION', () => {
  seedTask({
    id: 't1',
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    note: '- [ ] A\n- [ ] B',
    checks: [checkA],
  });
  const removed = save({ id: 't1', note: '- [ ] B' });
  expect(removed.ok).toBe(false);
  expect(removed.error.code).toBe('VALIDATION');
  expect(removed.error.fields.note).toContain('A');
  expect(save({ id: 't1', note: 'A\n- [ ] B' }).error.code).toBe('VALIDATION');
  expect(listHandovers_()[0]?.note).toBe('- [ ] A\n- [ ] B');
  expect(listHandovers_()[0]?.checks).toHaveLength(1);
});

test('save: butir kembar; menyunting kemunculan kedua tidak menyentuh centang pertama', () => {
  seedTask({
    id: 't1',
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    note: '- [ ] X\n- [ ] X',
    checks: [{ ...checkA, text: 'X' }],
  });
  const out = save({ id: 't1', note: '- [ ] X\n- [ ] Y' });
  expect(out.ok).toBe(true);
  expect(out.data.checklist.map((c: { checked: boolean }) => c.checked)).toEqual([true, false]);
});

test('save tanpa perubahan tidak menulis audit dan tidak mengubah updatedAt', () => {
  seedTask({ id: 't1', number: 'ST-20261015-001', locationId: ENV.locA, note: '- [ ] A' });
  const out = save({ id: 't1', note: '- [ ] A' });
  expect(out.ok).toBe(true);
  expect(out.data.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  expect(audits()).toEqual([]);
});

test('save dengan expectedUpdatedAt basi → CONFLICT', () => {
  seedTask({ id: 't1', number: 'ST-20261015-001', locationId: ENV.locA, note: '- [ ] A' });
  const out = save({ id: 't1', note: '- [ ] B', expectedUpdatedAt: '2025-01-01T00:00:00.000Z' });
  expect(out.error.code).toBe('CONFLICT');
  expect(
    save({ id: 't1', note: '- [ ] B', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }).ok,
  ).toBe(true);
});

test('save pada task Dibatalkan ditolak', () => {
  seedTask({
    id: 't1',
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    note: '- [ ] A',
    status: 'cancelled',
  });
  expect(save({ id: 't1', note: '- [ ] B' }).error.code).toBe('CONFLICT');
});

test('save: id di lokasi lain NOT_FOUND', () => {
  seedTask({ id: 't5', number: 'ST-20261015-005', locationId: ENV.locB, note: '- [ ] A' });
  expect(save({ id: 't5', note: 'x' }).error.code).toBe('NOT_FOUND');
});

test('QC tanpa handover:edit tidak dapat save (FORBIDDEN)', () => {
  expect(save({ note: 'x' }, 'qc@gmail.com').error.code).toBe('FORBIDDEN');
  expect(save({ note: 'x' }, 'viewer@gmail.com').error.code).toBe('FORBIDDEN');
});

const batch = (tasks: unknown, email = 'wh@gmail.com') =>
  call(email, 'handovers.saveBatch', { locationId: ENV.locA, tasks });

test('saveBatch menyimpan 3 task dengan nomor 001..003 dan satu customer baru untuk nama yang sama (customerKey)', () => {
  const out = batch([
    { customerName: 'CV. Prisma', note: '- [ ] A = 1' },
    { customerName: 'CV Prisma', note: '- [ ] B = 2' },
    { customerName: '', note: 'tanpa customer' },
  ]);
  expect(out.ok).toBe(true);
  expect(out.data.map((t: { number: string }) => t.number)).toEqual([
    'ST-20261015-001',
    'ST-20261015-002',
    'ST-20261015-003',
  ]);
  expect(listCustomers_().filter((c) => c.key === 'cv prisma')).toHaveLength(1);
  expect(out.data[0].customerId).toBe(out.data[1].customerId);
  expect(out.data[0].customerName).toBe('CV. Prisma');
  expect(out.data[1].customerName).toBe('CV. Prisma');
  expect(out.data[2].customerId).toBe('');
  expect(listHandovers_()).toHaveLength(3);
});

test('saveBatch: satu task tidak valid → tidak ada task, tidak ada customer baru, nomor berikutnya tetap 001', () => {
  insertCustomer_(customer('Nonaktif', { status: 'inactive' }));
  const customersBefore = listCustomers_().length;
  const tooLong = batch([
    { customerName: 'Baru Satu', note: 'ok' },
    { customerName: 'Baru Dua', note: 'a'.repeat(5001) },
  ]);
  expect(tooLong.error.code).toBe('VALIDATION');
  expect(tooLong.error.fields.tasks).toContain('Task 2');
  const inactive = batch([
    { customerName: 'Baru Satu', note: 'ok' },
    { customerName: 'Nonaktif', note: 'ok' },
  ]);
  expect(inactive.error.code).toBe('VALIDATION');
  expect(inactive.error.fields.tasks).toContain('Task 2');
  expect(listHandovers_()).toHaveLength(0);
  expect(listCustomers_()).toHaveLength(customersBefore);
  expect(audits()).toEqual([]);
  expect(save({ note: 'x' }).data.number).toBe('ST-20261015-001');
});

test('saveBatch melanjutkan nomor dari task yang sudah ada', () => {
  seedTask({ id: 't1', number: 'ST-20261015-007', locationId: ENV.locA });
  const out = batch([
    { customerName: '', note: 'a' },
    { customerName: '', note: 'b' },
  ]);
  expect(out.data.map((t: { number: string }) => t.number)).toEqual([
    'ST-20261015-008',
    'ST-20261015-009',
  ]);
});

test('saveBatch 31 task ditolak; kosong ditolak; QC tanpa edit FORBIDDEN', () => {
  const tasks = Array.from({ length: 31 }, () => ({ customerName: '', note: 'x' }));
  expect(batch(tasks).error.code).toBe('VALIDATION');
  expect(batch([]).error.code).toBe('VALIDATION');
  expect(batch(tasks.slice(0, 30)).data).toHaveLength(30);
  expect(batch([{ customerName: '', note: 'x' }], 'qc@gmail.com').error.code).toBe('FORBIDDEN');
});

test('saveBatch menulis audit handover.create per task', () => {
  batch([
    { customerName: 'PT Satu', note: '- [ ] A = 1' },
    { customerName: 'PT Dua', note: '- [ ] B = 1' },
  ]);
  expect(audits().filter((a) => a === 'handover.create')).toHaveLength(2);
  expect(audits().filter((a) => a === 'customer.create')).toHaveLength(2);
  const targets = listAuditRecords_()
    .filter((r) => r.action === 'handover.create')
    .map((r) => r.target);
  expect(targets).toEqual(['ST-20261015-001', 'ST-20261015-002']);
});
