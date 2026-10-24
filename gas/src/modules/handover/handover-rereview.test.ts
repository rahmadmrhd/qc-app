import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { handover } from '@gas-test/handover-fixtures';
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
const ref = { id: 't1', locationId: ENV.locA };

function seed(note: string): void {
  insertHandover_(
    handover({
      id: 't1',
      number: 'ST-20261015-001',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note,
    }),
  );
}

test('I-A: setCheck menerima teks kanonis dari DTO untuk butir berentitas/ber-escape ganda', () => {
  seed('- [ ] J&amp;amp;T = 1\n- [ ] x\\\\_y = 2');
  const board = call('qc@gmail.com', 'handovers.board', { locationIds: [ENV.locA] });
  const dto = board.data[0].checklist as Array<{ index: number; text: string }>;
  for (const item of dto) {
    const out = call('qc@gmail.com', 'handovers.setCheck', {
      ...ref,
      index: item.index,
      text: item.text,
      checked: true,
    });
    expect(out.ok).toBe(true);
  }
  expect(listHandovers_()[0]?.checks).toHaveLength(2);
});

test('I-A: teks mentah yang sama dengan butir tersimpan tetap diterima', () => {
  seed('- [ ] J&amp;amp;T = 1');
  const out = call('qc@gmail.com', 'handovers.setCheck', {
    ...ref,
    index: 0,
    text: 'J&amp;amp;T = 1',
    checked: true,
  });
  expect(out.ok).toBe(true);
});

test('I-B: audit save tidak memotong catatan yang muat; perubahan di akhir catatan terbaca', () => {
  const head = 'a'.repeat(3000);
  seed(`- [ ] A = 1\n\n${head}\n\nalamat lama`);
  const out = call('wh@gmail.com', 'handovers.save', {
    ...ref,
    customerName: '',
    note: `- [ ] A = 1\n\n${head}\n\nalamat baru`,
  });
  expect(out.ok).toBe(true);
  const audit = listAuditRecords_().find((r) => r.action === 'handover.update');
  const before = String(((audit?.before ?? {}) as Record<string, unknown>).note);
  const after = String(((audit?.after ?? {}) as Record<string, unknown>).note);
  expect(before).toContain('alamat lama');
  expect(after).toContain('alamat baru');
  expect(after).not.toContain('(dipotong)');
});

test('M-F: setDone dengan done:true memberi pesan yang tidak menyesatkan', () => {
  seed('- [ ] A = 1');
  const out = call('qc@gmail.com', 'handovers.setDone', { ...ref, done: true });
  expect(out.error.fields.done).not.toContain('dibuka kembali');
  expect(out.error.fields.done).toContain('done');
  const open = call('qc@gmail.com', 'handovers.setDone', { ...ref, done: false });
  expect(open.error.fields.done).toContain('dibuka kembali');
});

test('M-I: komentar umum menyimpan before/after kosong', () => {
  seed('- [ ] A = 1');
  const out = call('viewer@gmail.com', 'handovers.comment', {
    ...ref,
    quote: '',
    before: 'sisa',
    after: 'konteks',
    body: 'Umum',
  });
  expect(out.data.comments[0]).toMatchObject({ quote: '', before: '', after: '' });
});

// M-H (keputusan pemilik): perubahan yang hanya centang/komentar tidak memicu CONFLICT pada simpan.
const checkA = (email = 'qc@gmail.com') =>
  call(email, 'handovers.setCheck', { ...ref, index: 0, text: 'A = 1', checked: true });
const base = { note: '- [ ] A = 1\n- [ ] B = 2', customerId: '', status: 'new' };
const saveWith = (note: string, input: Record<string, unknown>, email = 'wh@gmail.com') =>
  call(email, 'handovers.save', { ...ref, customerName: '', note, ...input });

test('M-H: QC mencentang saat form ubah terbuka; simpan catatan lain berhasil dan centang tetap', () => {
  seed(base.note);
  const opened = listHandovers_()[0]?.updatedAt;
  expect(checkA().ok).toBe(true);
  const out = saveWith(`${base.note}\n\ntambahan`, { expectedUpdatedAt: opened, base });
  expect(out.ok).toBe(true);
  expect(out.data.checklist[0]).toMatchObject({ checked: true, by: 'qc@gmail.com' });
  expect(out.data.note).toContain('tambahan');
});

test('M-H: komentar masuk di tengah juga tidak memicu CONFLICT', () => {
  seed(base.note);
  const opened = listHandovers_()[0]?.updatedAt;
  call('viewer@gmail.com', 'handovers.comment', {
    ...ref,
    quote: '',
    before: '',
    after: '',
    body: 'x',
  });
  const out = saveWith(`${base.note}\n\nlagi`, { expectedUpdatedAt: opened, base });
  expect(out.ok).toBe(true);
  expect(out.data.comments).toHaveLength(1);
});

test('M-H: orang lain mengubah catatan -> CONFLICT', () => {
  seed(base.note);
  const opened = listHandovers_()[0]?.updatedAt;
  expect(saveWith(`${base.note}\n\ndari orang lain`, {}, 'whedit@gmail.com').ok).toBe(true);
  const out = saveWith(`${base.note}\n\nsaya`, { expectedUpdatedAt: opened, base });
  expect(out.error.code).toBe('CONFLICT');
});

test('M-H: status berubah menjadi Selesai atau Dibatalkan -> CONFLICT (aturan lama)', () => {
  seed(base.note);
  const opened = listHandovers_()[0]?.updatedAt;
  expect(call('qc@gmail.com', 'handovers.setDone', ref).ok).toBe(true);
  expect(saveWith(`${base.note}\n\nx`, { expectedUpdatedAt: opened, base }).error.code).toBe(
    'CONFLICT',
  );
  seed2Cancelled();
  const cancelled = saveWith('- [ ] A = 1', { id: 't2', expectedUpdatedAt: 'x', base });
  expect(cancelled.error.code).toBe('CONFLICT');
});

function seed2Cancelled(): void {
  insertHandover_(
    handover({
      id: 't2',
      number: 'ST-20261015-002',
      locationId: ENV.locA,
      customerId: '',
      customerName: '',
      note: '- [ ] A = 1',
      status: 'cancelled',
    }),
  );
}

test('M-H: tanpa base, updatedAt basi tetap CONFLICT (perilaku lama)', () => {
  seed(base.note);
  const opened = listHandovers_()[0]?.updatedAt;
  checkA();
  expect(saveWith(`${base.note}\n\nx`, { expectedUpdatedAt: opened }).error.code).toBe('CONFLICT');
});
