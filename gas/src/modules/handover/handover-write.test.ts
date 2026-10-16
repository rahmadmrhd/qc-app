import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { loadUserContext_ } from '@gas/modules/access/context';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertCustomer_, listCustomers_ } from '@gas/modules/customer/repo';
import { renameCustomer_ } from '@gas/modules/customer/service';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { customer, handover, handoverLine } from '@gas-test/handover-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_, insertHandoverLine_, listHandoverLines_, listHandovers_ } from './repo';

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
const save = (payload: Record<string, unknown>, email = 'wh@gmail.com') =>
  call(email, 'handovers.save', {
    locationId: ENV.locA,
    customerName: 'PT Maju',
    note: '',
    lines: [{ itemId: ENV.itemA, qty: 5 }],
    ...payload,
  });
function adminCtx() {
  const ctx = loadUserContext_('admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  return ctx;
}
const audits = () => listAuditRecords_().map((r) => r.action);

test('membuat task: nomor ST-YYYYMMDD-001, label baris disalin, status Baru, audit create setelah customer.create', () => {
  const out = save({
    note: 'catatan',
    lines: [
      { itemId: ENV.itemA, qty: 5 },
      { itemId: ENV.itemB, qty: 2 },
    ],
  });
  expect(out.ok).toBe(true);
  expect(out.data).toMatchObject({
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    customerName: 'PT Maju',
    note: 'catatan',
    status: 'new',
    totalUnits: 7,
    doneUnits: 0,
    createdBy: 'wh@gmail.com',
  });
  expect(
    out.data.lines.map((l: { itemLabel: string; qty: number }) => `${l.itemLabel} × ${l.qty}`),
  ).toEqual(['Ubiquiti ES 24 × 5', 'Mikrotik hAP ac2 × 2']);
  expect(audits()).toEqual(['customer.create', 'handover.create']);
  const created = listAuditRecords_().at(-1);
  expect(created).toMatchObject({ actor: 'wh@gmail.com', target: 'ST-20261015-001', before: null });
  expect(created?.after).toMatchObject({
    number: 'ST-20261015-001',
    location: 'Lokasi A',
    customer: 'PT Maju',
    status: 'new',
    lines: ['Ubiquiti ES 24 × 5', 'Mikrotik hAP ac2 × 2'],
  });
});

test('nomor urut per hari WIB: 001, 002; hari baru mulai 001; dibatalkan tidak menggandakan nomor', () => {
  expect(save({}).data.number).toBe('ST-20261015-001');
  const second = save({ lines: [{ itemId: ENV.itemB, qty: 1 }] });
  expect(second.data.number).toBe('ST-20261015-002');
  expect(
    call('wh@gmail.com', 'handovers.cancel', { id: second.data.id, locationId: ENV.locA }).ok,
  ).toBe(true);
  expect(save({ lines: [{ itemId: ENV.itemA, qty: 1 }] }).data.number).toBe('ST-20261015-003');
  clock = Date.parse('2026-10-15T17:00:00.000Z'); // 00:00 WIB hari berikutnya
  expect(save({}).data.number).toBe('ST-20261016-001');
});

test('customer inline: varian ejaan memakai customer yang ada (ejaan resmi menang); tidak ada duplikat', () => {
  save({ customerName: 'PT Maju Jaya' });
  const out = save({ customerName: ' pt. maju  JAYA ' });
  expect(out.data.customerName).toBe('PT Maju Jaya');
  expect(listCustomers_()).toHaveLength(1);
  expect(audits().filter((a) => a === 'customer.create')).toHaveLength(1);
});

test('customer nonaktif ditolak pada task baru (pesan di customerName) tanpa membuat apa pun', () => {
  insertCustomer_(customer('Lama', { status: 'inactive' }));
  const out = save({ customerName: 'lama' });
  expect(out.error).toMatchObject({
    code: 'VALIDATION',
    fields: { customerName: expect.stringContaining('dinonaktifkan') },
  });
  expect(listHandovers_()).toHaveLength(0);
});

test('validasi: customer, catatan, baris, qty, duplikat, item tak dikenal atau nonaktif; tidak ada customer yatim', () => {
  const fields = (over: Record<string, unknown>) =>
    save(over).error.fields as Record<string, string>;
  expect(fields({ customerName: '--' }).customerName).toBe(
    'Nama customer harus memuat huruf atau angka',
  );
  expect(fields({ note: 'x'.repeat(501) }).note).toBe('Maksimal 500 karakter');
  expect(fields({ lines: [] }).lines).toBe('Minimal satu baris');
  expect(fields({ lines: 'x' }).lines).toBe('Harus berupa daftar baris');
  for (const qty of [0, -1, 1.5, 100_001, '3', null, Number.NaN]) {
    expect(fields({ lines: [{ itemId: ENV.itemA, qty }] }).lines).toBe(
      'Baris 1: qty harus bilangan bulat 1–100000',
    );
  }
  expect(
    fields({
      lines: [
        { itemId: ENV.itemA, qty: 1 },
        { itemId: ENV.itemA, qty: 2 },
      ],
    }).lines,
  ).toBe('Baris 2: tipe yang sama sudah ada di baris 1');
  expect(fields({ lines: [{ itemId: 'tidak-ada', qty: 1 }] }).lines).toBe(
    'Baris 1: tipe tidak ditemukan',
  );
  expect(fields({ lines: [{ itemId: ENV.itemOff, qty: 1 }] }).lines).toContain('dinonaktifkan');
  expect(
    fields({ lines: Array.from({ length: 101 }, (_, i) => ({ itemId: `x${i}`, qty: 1 })) }).lines,
  ).toBe('Maksimal 100 baris');
  expect(listCustomers_()).toHaveLength(0);
  expect(listHandovers_()).toHaveLength(0);
});

test('izin per lokasi: WH loc-a tidak bisa menyimpan ke loc-b; QC (qc edit saja) dan viewer tidak bisa menyimpan; lokasi nonaktif/tak dikenal', () => {
  expect(save({ locationId: ENV.locB }).error.code).toBe('FORBIDDEN');
  expect(save({}, 'qc@gmail.com').error.code).toBe('FORBIDDEN');
  expect(save({}, 'viewer@gmail.com').error.code).toBe('FORBIDDEN');
  expect(save({ locationId: ENV.locOff }, 'multi@gmail.com').error.code).toBe('FORBIDDEN');
  expect(save({ locationId: 'loc-zzz' }).error.code).toBe('FORBIDDEN');
  expect(save({ locationId: ENV.locB }, 'multi@gmail.com').ok).toBe(true);
  expect(listHandovers_()).toHaveLength(1);
});

function seedTask(
  over: { status?: 'open' | 'cancelled'; locationId?: string; doneA?: number } = {},
) {
  insertCustomer_(customer('PT Maju'));
  insertHandover_(
    handover({
      id: 't1',
      number: 'ST-20261015-001',
      locationId: over.locationId ?? ENV.locA,
      status: over.status ?? 'open',
    }),
  );
  insertHandoverLine_(
    handoverLine({
      id: 'la',
      handoverId: 't1',
      itemId: ENV.itemA,
      qty: 5,
      doneQty: over.doneA ?? 0,
      doneAt: over.doneA ? '2026-10-15T01:00:00.000Z' : '',
      doneBy: over.doneA ? 'qc@gmail.com' : '',
    }),
  );
  insertHandoverLine_(
    handoverLine({
      id: 'lb',
      handoverId: 't1',
      itemId: ENV.itemB,
      itemLabel: 'Mikrotik hAP ac2',
      qty: 3,
    }),
  );
}

test('ubah task: qty, catatan, baris baru, baris tanpa progres dihapus; audit update dengan before/after; tanpa perubahan = tanpa audit', () => {
  seedTask();
  const same = save({
    id: 't1',
    lines: [
      { itemId: ENV.itemA, qty: 5 },
      { itemId: ENV.itemB, qty: 3 },
    ],
  });
  expect(same.ok).toBe(true);
  expect(audits()).toEqual([]);
  const out = save({ id: 't1', note: 'revisi', lines: [{ itemId: ENV.itemA, qty: 9 }] });
  expect(out.ok).toBe(true);
  expect(out.data).toMatchObject({
    note: 'revisi',
    totalUnits: 9,
    lineCount: 1,
    updatedBy: 'wh@gmail.com',
  });
  expect(listHandoverLines_().map((l) => l.id)).toEqual(['la']);
  expect(audits()).toEqual(['handover.update']);
  const entry = listAuditRecords_().at(-1);
  expect(entry?.before).toMatchObject({
    lines: ['Ubiquiti ES 24 × 5', 'Mikrotik hAP ac2 × 3'],
    note: '',
  });
  expect(entry?.after).toMatchObject({ lines: ['Ubiquiti ES 24 × 9'], note: 'revisi' });
});

test('ubah task: qty di bawah qty selesai ditolak; baris ber-progres tidak dapat dihapus; pesan di field lines', () => {
  seedTask({ doneA: 3 });
  const below = save({
    id: 't1',
    lines: [
      { itemId: ENV.itemA, qty: 2 },
      { itemId: ENV.itemB, qty: 3 },
    ],
  });
  expect(below.error).toMatchObject({
    code: 'VALIDATION',
    fields: { lines: expect.stringContaining('di bawah qty selesai (3)') },
  });
  const removed = save({ id: 't1', lines: [{ itemId: ENV.itemB, qty: 3 }] });
  expect(removed.error).toMatchObject({
    code: 'VALIDATION',
    fields: { lines: expect.stringContaining('sudah ada progres') },
  });
  expect(listHandoverLines_()).toHaveLength(2);
  expect(
    save({
      id: 't1',
      lines: [
        { itemId: ENV.itemA, qty: 3 },
        { itemId: ENV.itemB, qty: 3 },
      ],
    }).ok,
  ).toBe(true); // tepat sama dengan selesai
});

test('item nonaktif boleh tetap di baris lama tetapi tidak sebagai baris baru', () => {
  seedTask();
  insertHandoverLine_(
    handoverLine({
      id: 'loff',
      handoverId: 't1',
      itemId: ENV.itemOff,
      itemLabel: 'Ubiquiti Lama',
      qty: 1,
    }),
  );
  const keep = save({
    id: 't1',
    lines: [
      { itemId: ENV.itemA, qty: 5 },
      { itemId: ENV.itemB, qty: 3 },
      { itemId: ENV.itemOff, qty: 2 },
    ],
  });
  expect(keep.ok).toBe(true);
  expect(keep.data.lines.find((l: { itemId: string }) => l.itemId === ENV.itemOff).qty).toBe(2);
});

test('ubah task: task Dibatalkan tidak dapat diubah (CONFLICT)', () => {
  seedTask({ status: 'cancelled' });
  expect(save({ id: 't1' }).error).toMatchObject({
    code: 'CONFLICT',
    message: 'Task sudah dibatalkan dan tidak dapat diubah',
  });
});

test('task Selesai tetap dapat diubah WH (naikkan qty membuka lagi); task milik lokasi lain tidak ditemukan walau user punya izin di lokasi yang diklaim', () => {
  insertCustomer_(customer('PT Maju'));
  insertHandover_(handover({ id: 'done', number: 'ST-20261015-001', locationId: ENV.locA }));
  insertHandoverLine_(
    handoverLine({ id: 'ld', handoverId: 'done', itemId: ENV.itemA, qty: 2, doneQty: 2 }),
  );
  const reopened = save({ id: 'done', lines: [{ itemId: ENV.itemA, qty: 5 }] });
  expect(reopened.ok).toBe(true);
  expect(reopened.data.status).toBe('in_progress');
  expect(save({ id: 'done', note: 'catatan baru' }).data.note).toBe('catatan baru');
  insertHandover_(handover({ id: 'inb', number: 'ST-20261015-002', locationId: ENV.locB }));
  insertHandoverLine_(handoverLine({ id: 'lb2', handoverId: 'inb', itemId: ENV.itemA, qty: 2 }));
  // multi@ boleh menulis di A dan B; mengklaim A untuk task milik B → NOT_FOUND
  expect(save({ id: 'inb', locationId: ENV.locA }, 'multi@gmail.com').error.code).toBe('NOT_FOUND');
  expect(save({ id: 'tidak-ada' }).error.code).toBe('NOT_FOUND');
});

test('ubah customer task memakai customer inline; customer nonaktif yang sudah dipakai task itu tetap boleh', () => {
  insertCustomer_(customer('PT Maju', { status: 'inactive' }));
  insertHandover_(handover({ id: 't1', number: 'ST-20261015-001', locationId: ENV.locA }));
  insertHandoverLine_(handoverLine({ id: 'la', handoverId: 't1', itemId: ENV.itemA, qty: 5 }));
  expect(save({ id: 't1', note: 'x' }).ok).toBe(true); // tetap PT Maju (nonaktif) karena sudah dipakai
  const moved = save({ id: 't1', customerName: 'Customer Baru', note: 'x' });
  expect(moved.data.customerName).toBe('Customer Baru');
  expect(audits()).toContain('customer.create');
});

test('batalkan: WH manage; edit-saja ditolak; idempoten; task Selesai tidak dapat dibatalkan; audit handover.cancel', () => {
  seedTask({ doneA: 2 });
  const ref = { id: 't1', locationId: ENV.locA };
  expect(call('whedit@gmail.com', 'handovers.cancel', ref).error.code).toBe('FORBIDDEN');
  expect(call('qc@gmail.com', 'handovers.cancel', ref).error.code).toBe('FORBIDDEN');
  const out = call('wh@gmail.com', 'handovers.cancel', ref);
  expect(out.data.status).toBe('cancelled');
  expect(audits()).toEqual(['handover.cancel']);
  expect(listAuditRecords_().at(-1)).toMatchObject({
    before: { status: 'in_progress' },
    after: { status: 'cancelled' },
  });
  const again = call('wh@gmail.com', 'handovers.cancel', ref);
  expect(again.data.status).toBe('cancelled');
  expect(audits()).toEqual(['handover.cancel']); // idempoten: tidak mencatat lagi
  expect(
    call('wh@gmail.com', 'handovers.cancel', { id: 't1', locationId: ENV.locB }).error.code,
  ).toBe('FORBIDDEN');
});

test('batalkan: task Selesai CONFLICT; task lokasi lain NOT_FOUND', () => {
  insertCustomer_(customer('PT Maju'));
  insertHandover_(handover({ id: 'done', number: 'ST-20261015-001', locationId: ENV.locA }));
  insertHandoverLine_(
    handoverLine({ id: 'ld', handoverId: 'done', itemId: ENV.itemA, qty: 2, doneQty: 2 }),
  );
  expect(
    call('wh@gmail.com', 'handovers.cancel', { id: 'done', locationId: ENV.locA }).error.code,
  ).toBe('CONFLICT');
  insertHandover_(handover({ id: 'inb', number: 'ST-20261015-002', locationId: ENV.locB }));
  expect(
    call('multi@gmail.com', 'handovers.cancel', { id: 'inb', locationId: ENV.locA }).error.code,
  ).toBe('NOT_FOUND');
});

test('customer opsional: task dapat disimpan tanpa customer (tidak membuat customer/audit customer), diisi, lalu dikosongkan lagi', () => {
  for (const blank of ['', '   ']) {
    const out = save({ customerName: blank });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ customerId: '', customerName: '' });
  }
  expect(listCustomers_()).toHaveLength(0);
  expect(audits()).toEqual(['handover.create', 'handover.create']);
  const id = listHandovers_()[0]?.id ?? '';
  const filled = save({ id, customerName: 'PT Baru' });
  expect(filled.data.customerName).toBe('PT Baru');
  const cleared = save({ id, customerName: '' });
  expect(cleared.data).toMatchObject({ customerId: '', customerName: '' });
  expect(listCustomers_()).toHaveLength(1); // customer yang sudah dibuat tidak dihapus
  expect(audits().filter((a) => a === 'handover.update')).toHaveLength(2);
  expect(save({ customerName: '--' }).error.fields.customerName).toBe(
    'Nama customer harus memuat huruf atau angka',
  );
});

test('Ubah yang membuat task Selesai (hapus baris terakhir yang belum penuh) mencatat handover.complete tepat sekali', () => {
  seedTask({ doneA: 5 });
  const out = save({ id: 't1', lines: [{ itemId: ENV.itemA, qty: 5 }] }); // hapus baris B (0/3) → semua penuh
  expect(out.ok).toBe(true);
  expect(out.data.status).toBe('done');
  expect(audits()).toEqual(['handover.update', 'handover.complete']);
  expect(listAuditRecords_().at(-1)).toMatchObject({
    action: 'handover.complete',
    target: 'ST-20261015-001',
    before: { status: 'in_progress' },
    after: { status: 'done' },
  });
  // Selesai tidak mengunci WH: ubah catatan tetap boleh dan tidak mencatat handover.complete lagi.
  expect(save({ id: 't1', note: 'x' }).ok).toBe(true);
  expect(audits().filter((action) => action === 'handover.complete')).toHaveLength(1);
});

test('Ubah yang tidak membuat task Selesai tidak mencatat handover.complete', () => {
  seedTask({ doneA: 2 });
  save({
    id: 't1',
    lines: [
      { itemId: ENV.itemA, qty: 2 },
      { itemId: ENV.itemB, qty: 3 },
    ],
  }); // A penuh, B belum
  expect(audits()).toEqual(['handover.update']);
});

test('Ubah tanpa perubahan setelah customer diganti nama tidak menulis audit maupun memperbarui updatedAt (M2)', () => {
  seedTask();
  renameCustomer_({ id: 'cust-pt-maju', name: 'PT Maju Sejahtera' }, adminCtx());
  const before = listHandovers_()[0]?.updatedAt;
  const auditCount = listAuditRecords_().length;
  const out = save({
    id: 't1',
    customerName: 'PT Maju Sejahtera',
    lines: [
      { itemId: ENV.itemA, qty: 5 },
      { itemId: ENV.itemB, qty: 3 },
    ],
  });
  expect(out.ok).toBe(true);
  expect(listAuditRecords_()).toHaveLength(auditCount);
  expect(listHandovers_()[0]?.updatedAt).toBe(before);
});

test('urutan baris berbeda dari urutan tersimpan bukan perubahan (tanpa audit) (M6)', () => {
  seedTask();
  const out = save({
    id: 't1',
    lines: [
      { itemId: ENV.itemB, qty: 3 },
      { itemId: ENV.itemA, qty: 5 },
    ],
  });
  expect(out.ok).toBe(true);
  expect(audits()).toEqual([]);
});

test('id dengan spasi di tepi di-trim; id tak dikenal tetap NOT_FOUND (M7)', () => {
  seedTask();
  expect(save({ id: '  t1  ', note: 'baru' }).data.note).toBe('baru');
  expect(save({ id: '   ', note: 'x' }).data.number).toMatch(/^ST-/); // spasi saja = buat baru
});

test('konkurensi optimistis: expectedUpdatedAt basi → CONFLICT dan task tidak berubah; cocok atau kosong → tersimpan', () => {
  const created = save({ note: 'awal' });
  const id = created.data.id as string;
  const stale = save({ id, note: 'timpa', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
  expect(stale.error.code).toBe('CONFLICT');
  expect(stale.error.message).toContain('diubah orang lain');
  expect(listHandovers_()[0]?.note).toBe('awal');

  const ok = save({ id, note: 'cocok', expectedUpdatedAt: created.data.updatedAt });
  expect(ok.ok).toBe(true);
  expect(save({ id, note: 'tanpa' }).ok).toBe(true);
});

test('ubah task yang qty selesainya melebihi target: simpan tanpa mengubah qty tetap diterima', () => {
  seedTask({ doneA: 7 });
  expect(
    save({
      id: 't1',
      note: 'catatan',
      lines: [
        { itemId: ENV.itemA, qty: 5 },
        { itemId: ENV.itemB, qty: 3 },
      ],
    }).ok,
  ).toBe(true);
});
